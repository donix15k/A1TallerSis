// TDSI-200/201/202: GET y PUT /api/kpis/objetivos ("Configurar objetivos"). BD real: se respalda pagos.kpi_objetivos y se RESTAURA al terminar.
// Gestion de Caja (validacion de administrador y metas mensuales de las cajas) es un servidor HTTP local.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/kpiRoutes");
const { validarIndicadores, errorDeLimite, colorDe, limitesDe } = require("../services/kpiObjetivosService");

let caja, servidor, base;
let respaldo; // las 7 filas originales
let cajaMetas; // lo que Caja responde al GET de metas: lista de cajas, o "caida"
let cajaPut; // lo que Caja responde al PUT: { status, cuerpo }
let llamadas; // lo que recibio Caja: { metodo, url, token, cuerpo }

const ind = (indicador, verde, amarillo, rojo, extra = {}) => ({ indicador, verde, amarillo, rojo, ...extra });
const fila = async (indicador) => (await query(`SELECT * FROM pagos.kpi_objetivos WHERE indicador = $1`, [indicador])).rows[0];

test.before(async () => {
  respaldo = (await query(`SELECT * FROM pagos.kpi_objetivos`)).rows;
  caja = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const token = req.headers.authorization || "";
    if (req.url.startsWith("/api/administradores/verificar")) {
      if (token === "Bearer ADMIN") return res.end(JSON.stringify({ ok: true, data: { administrador_id: "adm-1", nombre: "Admin Prueba" } }));
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok: false, mensaje: "no" }));
    }
    if (req.url.startsWith("/api/kpis/metas-mensuales")) {
      let cuerpo = "";
      req.on("data", (c) => { cuerpo += c; });
      req.on("end", () => {
        llamadas.push({ metodo: req.method, url: req.url, token, cuerpo: cuerpo ? JSON.parse(cuerpo) : null });
        if (req.method === "GET") {
          if (cajaMetas === "caida") { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, mensaje: "boom" })); }
          return res.end(JSON.stringify({ ok: true, data: { cajas: cajaMetas } }));
        }
        res.statusCode = cajaPut.status;
        res.end(JSON.stringify(cajaPut.cuerpo));
      });
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((r) => caja.listen(0, r));
  process.env.ADMIN_VERIFICAR_URL = `http://localhost:${caja.address().port}`;
  process.env.GESTION_CAJA_URL = `http://localhost:${caja.address().port}`;
  const app = express();
  app.use(express.json());
  app.use("/api/kpis", rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis/objetivos`;
});
test.beforeEach(async () => {
  llamadas = [];
  cajaMetas = [{ caja_id: "CAJA-01", caja_nombre: "Caja 1", monto_mensual: 10000, meta_diaria: null }, { caja_id: "CAJA-02", caja_nombre: "Caja 2", monto_mensual: null, meta_diaria: 300 }];
  cajaPut = { status: 200, cuerpo: { ok: true, data: { cajas: [{ caja_id: "CAJA-01", caja_nombre: "Caja 1", monto_mensual: 12000, meta_diaria: null }] } } };
  await restaurar(); // cada prueba parte de los objetivos originales
});
test.after(async () => {
  await restaurar();
  delete process.env.ADMIN_VERIFICAR_URL;
  delete process.env.GESTION_CAJA_URL;
  servidor.close();
  caja.close();
  await pool.end();
});

async function restaurar() {
  for (const r of respaldo) {
    await query(`UPDATE pagos.kpi_objetivos SET limite_verde = $2, limite_amarillo = $3, limite_rojo = $4, actualizado_por = $5, actualizado_en = $6 WHERE indicador = $1`, [r.indicador, r.limite_verde, r.limite_amarillo, r.limite_rojo, r.actualizado_por, r.actualizado_en]);
  }
}
const pedir = (metodo, cuerpo, { token = "ADMIN", qs = "" } = {}) =>
  fetch(`${base}${qs}`, { method: metodo, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));
const errores = (r) => Object.fromEntries((r.cuerpo.detalle?.errores || []).map((e) => [e.campo, e.mensaje]));

// ---------------------------------------------------------------- GET (TDSI-200)
test("GET: los limites de los 7 KPIs y la meta mensual de cada caja, con el token reenviado a Caja", async () => {
  const { status, cuerpo } = await pedir("GET");
  assert.equal(status, 200);
  assert.equal(cuerpo.data.indicadores.length, 7);
  assert.deepEqual(cuerpo.data.metas_cajas.map((c) => [c.caja_id, c.monto_mensual]), [["CAJA-01", 10000], ["CAJA-02", null]]);
  assert.equal(cuerpo.data.metas_error, null);
  assert.deepEqual(llamadas.map((l) => [l.metodo, l.token]), [["GET", "Bearer ADMIN"]]);
});

test("GET ?metas=no (lo que piden los demas servicios): solo los limites, sin llamar a Caja", async () => {
  const { cuerpo } = await pedir("GET", null, { qs: "?metas=no" });
  assert.deepEqual(Object.keys(cuerpo.data), ["indicadores"]);
  assert.equal(llamadas.length, 0);
});

test("GET con Caja caida: la ventana abre igual, con los limites y las metas vacias + el motivo", async () => {
  cajaMetas = "caida";
  const { status, cuerpo } = await pedir("GET");
  assert.equal(status, 200);
  assert.equal(cuerpo.data.indicadores.length, 7);
  assert.deepEqual([cuerpo.data.metas_cajas, cuerpo.data.metas_error], [[], "boom"]);
});

// ---------------------------------------------------------------- validacion (TDSI-201)
test("validacion de un limite: numero de 0 al tope de su unidad (porcentajes de 0 a 100), hasta 2 decimales", () => {
  assert.equal(errorDeLimite(45, "Bs"), null);
  assert.equal(errorDeLimite("1.5", "%"), null);
  assert.equal(errorDeLimite(100, "%"), null);
  assert.equal(errorDeLimite(0, "%"), null);
  assert.match(errorDeLimite(100.01, "%"), /0 a 100/);
  assert.match(errorDeLimite(-1, "%"), /negativo/);
  assert.match(errorDeLimite("abc", "Bs"), /número/);
  assert.match(errorDeLimite(1.234, "%"), /2 decimales/);
  for (const vacio of [null, undefined, "", true]) assert.ok(errorDeLimite(vacio, "%"));
  assert.ok(errorDeLimite(4000, "días"));
});

test("el amarillo siempre entre el verde y el rojo: MAYOR (rojo <= amarillo <= verde) y MENOR (verde <= amarillo <= rojo)", () => {
  const ok = (l) => validarIndicadores(l).errores;
  assert.deepEqual(ok([ind("ticket_promedio", 45, 35, 0)]), []);
  assert.deepEqual(ok([ind("ticket_promedio", 45, 45, 0), ind("tasa_anulacion", 2, 2, 10)]), []); // los extremos valen
  const mayor = ok([ind("ticket_promedio", 45, 50, 0)]);
  assert.deepEqual(mayor.map((e) => [e.campo, e.mensaje]), [["ticket_promedio.amarillo", "El amarillo debe quedar entre el verde y el rojo."]]);
  assert.equal(ok([ind("ticket_promedio", 45, -0.01, 0)])[0].campo, "ticket_promedio.amarillo"); // negativo: lo atrapa el limite
  assert.equal(ok([ind("cumplimiento_metas", 50, 70, 0)])[0].campo, "cumplimiento_metas.amarillo"); // amarillo por encima del verde
  assert.deepEqual(ok([ind("tasa_anulacion", 2, 1, 10)]).map((e) => e.campo), ["tasa_anulacion.amarillo"]); // MENOR: amarillo por debajo del verde
  assert.deepEqual(ok([ind("tasa_anulacion", 2, 12, 10)]).map((e) => e.campo), ["tasa_anulacion.amarillo"]); // MENOR: amarillo por encima del rojo
  assert.deepEqual(ok([ind("ticket_promedio", 10, 20, 30)]).map((e) => e.campo), ["ticket_promedio.verde"]); // MAYOR con verde < rojo
  assert.deepEqual(ok([ind("tasa_anulacion", 8, 9, 5)]).map((e) => e.campo), ["tasa_anulacion.verde"]); // MENOR con verde > rojo
});

test("cada error trae su campo; un indicador desconocido, repetido o con otro sentido tambien se rechaza", () => {
  const r = validarIndicadores([ind("inventado", 1, 2, 3), ind("efectividad_cuadre", 95, 85, 0), ind("efectividad_cuadre", 90, 80, 0), ind("tasa_devoluciones", 1.5, "x", 6), ind("aceptacion_contable", 98, 95, 0, { sentido: "MENOR" })]);
  const por = Object.fromEntries(r.errores.map((e) => [e.campo, e.mensaje]));
  assert.match(por["indicadores.inventado"], /no existe/);
  assert.match(por["efectividad_cuadre.indicador"], /repetido/);
  assert.match(por["tasa_devoluciones.amarillo"], /número/);
  assert.match(por["aceptacion_contable.sentido"], /MAYOR/);
  assert.equal(r.cambios.length, 1); // solo el primer efectividad_cuadre es valido
});

// ---------------------------------------------------------------- PUT (TDSI-201/202)
test("PUT: guarda los limites (con quien los cambio), devuelve la ventana actualizada y el color cambia desde ese momento", async () => {
  assert.equal(await colorDe("ticket_promedio", 42), "AMARILLO");
  const { status, cuerpo } = await pedir("PUT", { indicadores: [ind("ticket_promedio", 40, 30, 0), ind("tasa_anulacion", 1, 3, 8)] });
  assert.equal(status, 200);
  const t = cuerpo.data.indicadores.find((i) => i.indicador === "ticket_promedio");
  assert.deepEqual([t.verde, t.amarillo, t.rojo, t.sentido, t.actualizado_por], [40, 30, 0, "MAYOR", "Admin Prueba"]);
  assert.deepEqual((await limitesDe("tasa_anulacion")).amarillo, 3);
  assert.equal(await colorDe("ticket_promedio", 42), "VERDE"); // antes era AMARILLO
  assert.equal(llamadas.filter((l) => l.metodo === "PUT").length, 0); // sin metas no se llama a Caja para guardar
});

test("PUT con un valor invalido: 400 con los errores por campo y NO se guarda nada (ni lo valido)", async () => {
  const antes = await fila("ticket_promedio");
  const r = await pedir("PUT", { indicadores: [ind("ticket_promedio", 41, 36, 0), ind("tasa_anulacion", 2, 50, 10), ind("efectividad_cuadre", 95, 85, 120)] });
  assert.equal(r.status, 400);
  const e = errores(r);
  assert.match(e["tasa_anulacion.amarillo"], /entre el verde y el rojo/);
  assert.match(e["efectividad_cuadre.rojo"], /0 a 100/);
  assert.equal(Object.keys(e).length, 2);
  assert.equal(Number((await fila("ticket_promedio")).limite_verde), Number(antes.limite_verde)); // el valido tampoco se guardo
});

test("PUT con metas: las manda a Caja con el token del administrador y las devuelve junto a los limites", async () => {
  const metas = [{ caja_id: "CAJA-01", monto_mensual: 12000 }];
  const { status, cuerpo } = await pedir("PUT", { indicadores: [ind("ticket_promedio", 50, 40, 0)], metas_cajas: metas });
  assert.equal(status, 200);
  const put = llamadas.find((l) => l.metodo === "PUT");
  assert.deepEqual([put.token, put.cuerpo], ["Bearer ADMIN", { metas }]);
  assert.equal(cuerpo.data.indicadores.find((i) => i.indicador === "ticket_promedio").verde, 50);
  assert.ok(Array.isArray(cuerpo.data.metas_cajas));
});

test("PUT solo con metas (sin limites) tambien funciona", async () => {
  const { status } = await pedir("PUT", { metas_cajas: [{ caja_id: "CAJA-01", monto_mensual: 5000 }] });
  assert.equal(status, 200);
  assert.equal(llamadas.filter((l) => l.metodo === "PUT").length, 1);
});

test("PUT: si Caja rechaza las metas (400) el error de Caja llega tal cual y los limites se DESHACEN", async () => {
  cajaPut = { status: 400, cuerpo: { ok: false, mensaje: "Hay metas mensuales que no se pueden guardar.", detalle: { errores: [{ campo: "metas_cajas.CAJA-01", mensaje: "La meta debe ser mayor a 0." }] } } };
  const antes = await fila("ticket_promedio");
  const r = await pedir("PUT", { indicadores: [ind("ticket_promedio", 60, 50, 0)], metas_cajas: [{ caja_id: "CAJA-01", monto_mensual: 0 }] });
  assert.equal(r.status, 400);
  assert.equal(errores(r)["metas_cajas.CAJA-01"], "La meta debe ser mayor a 0.");
  assert.equal(Number((await fila("ticket_promedio")).limite_verde), Number(antes.limite_verde)); // el limite NO quedo guardado
});

test("PUT: si Caja no responde es 502 y los limites se DESHACEN (todo o nada)", async () => {
  const url = process.env.GESTION_CAJA_URL;
  process.env.GESTION_CAJA_URL = "http://localhost:1";
  try {
    const antes = await fila("ticket_promedio");
    const r = await pedir("PUT", { indicadores: [ind("ticket_promedio", 60, 50, 0)], metas_cajas: [{ caja_id: "CAJA-01", monto_mensual: 100 }] });
    assert.equal(r.status, 502);
    assert.match(r.cuerpo.mensaje, /No se guardó ningún cambio/);
    assert.equal(Number((await fila("ticket_promedio")).limite_verde), Number(antes.limite_verde));
  } finally {
    process.env.GESTION_CAJA_URL = url;
  }
});

test("PUT sin nada que guardar o con listas mal formadas: 400", async () => {
  for (const cuerpo of [{}, { indicadores: [] }, { indicadores: "x" }, { metas_cajas: {} }, { indicadores: [], metas_cajas: [] }]) {
    assert.equal((await pedir("PUT", cuerpo)).status, 400, JSON.stringify(cuerpo));
  }
});

test("solo el administrador: sin token 401 (GET y PUT) y el PUT sin token no cambia nada", async () => {
  assert.equal((await pedir("GET", null, { token: null })).status, 401);
  const antes = await fila("ticket_promedio");
  assert.equal((await pedir("PUT", { indicadores: [ind("ticket_promedio", 60, 50, 0)] }, { token: null })).status, 401);
  assert.equal((await pedir("PUT", { indicadores: [ind("ticket_promedio", 60, 50, 0)] }, { token: "otro" })).status, 401);
  assert.equal(Number((await fila("ticket_promedio")).limite_verde), Number(antes.limite_verde));
});
