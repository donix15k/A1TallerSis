// TDSI-179/180: GET /api/kpis/aceptacion-contable. BD real: facturas y envios de prueba insertados DIRECTO en un mes lejano (mayo de
// 2008) y borrados al terminar. Gestion de Caja (validacion de administrador y diferencias de caja) y Devoluciones (notas de credito)
// son servidores HTTP locales. Nunca se publica nada a Contabilidad: solo se leen los envios ya guardados.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const { requireAdministrador } = require("../middlewares/requireAdministrador");
const rutas = require("../routes/kpiRoutes");
const { colorAceptacion, UMBRALES_ACEPTACION } = require("../services/kpiAceptacionService");

let caja, devs, servidor, base;
let nc; // lo que responde Devoluciones: objeto de datos, o "caida"
let dif; // lo que responde Caja en /api/kpis/asientos-contables: objeto de datos, o "caida"
let tokensRecibidos;
let n = 0;

const datos = (enviados, registrados, rechazados, lista = []) => ({ enviados, registrados, rechazados, sin_respuesta: enviados - registrados - rechazados, rechazados_lista: lista });

/** Una factura de prueba con su envio a Contabilidad (estado/fecha/resultado describen el envio). */
async function envio({ tipo = "venta", estado = "Enviado", enviado = null, resultado = null, motivo = null }) {
  n += 1;
  const numero = `F-K179-${String(n).padStart(3, "0")}`;
  const f = await pool.query(
    `INSERT INTO facturacion.facturas (numero, venta_id, cliente_nit, cliente_nombre, subtotal, descuento, impuesto, total, impresa, veces_impresa)
     VALUES ($1, $2, NULL, 'Prueba', 10, 0, 1.3, 10, false, 0) RETURNING id`,
    [numero, `V-K179-${n}`]
  );
  await pool.query(
    `INSERT INTO facturacion.factura_envios_contabilidad (factura_id, tipo, estado, enviado_en, payload, resultado, resultado_motivo)
     VALUES ($1, $2, $3, $4::timestamptz, '{}'::jsonb, $5, $6)`,
    [f.rows[0].id, tipo, estado, enviado, resultado, motivo]
  );
  return numero;
}
const limpiar = () => pool.query(`DELETE FROM facturacion.facturas WHERE numero LIKE 'F-K179-%'`); // arrastra items y envios

let numeroRechazada, numeroAnulacion;
test.before(async () => {
  await limpiar();
  tokensRecibidos = [];
  caja = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const token = req.headers.authorization || "";
    if (req.url.startsWith("/api/administradores/verificar")) {
      if (token === "Bearer ADMIN") return res.end(JSON.stringify({ ok: true, data: { administrador_id: "A" } }));
      res.statusCode = token === "Bearer CAJERO" ? 403 : 401;
      return res.end(JSON.stringify({ ok: false, mensaje: "no" }));
    }
    if (req.url.startsWith("/api/kpis/asientos-contables")) {
      tokensRecibidos.push(token);
      if (dif === "caida") { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, mensaje: "boom caja" })); }
      return res.end(JSON.stringify({ ok: true, data: dif }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((r) => caja.listen(0, r));
  process.env.GESTION_CAJA_URL = `http://localhost:${caja.address().port}`;
  delete process.env.ADMIN_VERIFICAR_URL;
  devs = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    tokensRecibidos.push(req.headers.authorization || "");
    if (nc === "caida") { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, mensaje: "boom dev" })); }
    res.end(JSON.stringify({ ok: true, data: nc }));
  });
  await new Promise((r) => devs.listen(0, r));
  process.env.DEVOLUCIONES_URL = `http://localhost:${devs.address().port}`;

  try {
    // mayo de 2008, facturas: 7 enviadas -> 3 aceptadas + 1 registrada, 2 rechazadas (una venta y una anulacion), 1 sin respuesta
    await envio({ enviado: "2008-05-01 00:30:00-04", resultado: "aceptado" }); // primer dia, 00:30 Bolivia
    await envio({ enviado: "2008-05-10 10:00:00-04", resultado: "aceptado" });
    await envio({ enviado: "2008-05-11 10:00:00-04", resultado: "aceptado" });
    await envio({ enviado: "2008-05-12 10:00:00-04", resultado: "registrado" });
    numeroRechazada = await envio({ enviado: "2008-05-31 23:30:00-04", resultado: "rechazado", motivo: "cuenta contable inexistente" }); // ultimo dia, 03:30Z del 1/6
    numeroAnulacion = await envio({ tipo: "anulacion", enviado: "2008-05-20 10:00:00-04", resultado: "rechazado" }); // sin motivo informado
    await envio({ enviado: "2008-05-21 10:00:00-04" }); // sin respuesta todavia: NO cuenta como rechazada
    // NO cuentan: nunca salieron (Pendiente / Error) y enviadas en otro mes (hora de Bolivia)
    await envio({ estado: "Pendiente" });
    await envio({ estado: "Error" });
    await envio({ enviado: "2008-04-30 23:50:00-04", resultado: "rechazado", motivo: "de abril" });
    await envio({ enviado: "2008-06-01 00:10:00-04", resultado: "rechazado", motivo: "de junio" });
  } catch (e) {
    await limpiar();
    caja.close();
    devs.close();
    await pool.end();
    throw e;
  }

  const app = express();
  app.use(express.json());
  app.use("/api/kpis", requireAdministrador, rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis/aceptacion-contable`;
});
test.beforeEach(() => {
  tokensRecibidos = [];
  nc = datos(3, 3, 0); // notas de credito: 3 enviadas, 3 registradas
  dif = datos(2, 1, 1, [{ id: "9", referencia: "DIF-9", tipo: "DIFERENCIA_CAJA", motivo: "cuenta de caja inexistente", enviado_en: "2008-05-25T14:00:00.000Z" }]);
});
test.after(async () => {
  servidor.close();
  caja.close();
  devs.close();
  delete process.env.GESTION_CAJA_URL;
  delete process.env.DEVOLUCIONES_URL;
  await limpiar();
  await pool.end();
});

const pedir = (qs = "?periodo=2008-05", token = "ADMIN") => fetch(`${base}${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

test("semaforo: VERDE desde 98 %, AMARILLO de 95 a 97,99 %, ROJO por debajo de 95 %", () => {
  const casos = [[100, "VERDE"], [98.7, "VERDE"], [98, "VERDE"], [97.99, "AMARILLO"], [95, "AMARILLO"], [94.99, "ROJO"], [0, "ROJO"]];
  for (const [pct, color] of casos) assert.equal(colorAceptacion(pct), color, String(pct));
  assert.deepEqual(UMBRALES_ACEPTACION, { verde: 98, amarillo: 95 });
});

test("suma facturas + notas de credito + diferencias de caja: enviados, registrados, rechazados y el % con su color", async () => {
  const { status, cuerpo } = await pedir();
  assert.equal(status, 200);
  const d = cuerpo.data;
  assert.deepEqual([d.periodo, d.desde, d.hasta], ["2008-05", "2008-05-01", "2008-05-31"]);
  // facturas 7 (4 registradas, 2 rechazadas, 1 sin respuesta) + NC 3 (3) + diferencias 2 (1 registrada, 1 rechazada) = 12 enviados, 8 registrados
  assert.deepEqual([d.enviados, d.registrados, d.rechazados, d.sin_respuesta], [12, 8, 3, 1]);
  assert.deepEqual([d.porcentaje, d.color, d.sin_asientos, d.incompleto], [66.67, "ROJO", false, false]);
  assert.deepEqual(d.por_tipo.facturas, { disponible: true, enviados: 7, registrados: 4, rechazados: 2, sin_respuesta: 1 });
  assert.deepEqual(d.por_tipo.notas_credito, { disponible: true, enviados: 3, registrados: 3, rechazados: 0, sin_respuesta: 0 });
  assert.deepEqual(d.por_tipo.diferencias_caja, { disponible: true, enviados: 2, registrados: 1, rechazados: 1, sin_respuesta: 0 });
  assert.deepEqual(d.umbrales, { verde: 98, amarillo: 95 });
});

test("el color sigue el % total: 98,7 % es VERDE y 96,3 % es AMARILLO", async () => {
  nc = datos(1000, 1000, 0);
  const verde = (await pedir()).cuerpo.data; // 1009 enviados, 1005 registrados
  assert.deepEqual([verde.enviados, verde.registrados, verde.porcentaje, verde.color], [1009, 1005, 99.6, "VERDE"]);
  nc = datos(100, 100, 0);
  const amarillo = (await pedir()).cuerpo.data; // 109 enviados, 105 registrados
  assert.deepEqual([amarillo.enviados, amarillo.registrados, amarillo.porcentaje, amarillo.color], [109, 105, 96.33, "AMARILLO"]);
});

test("la lista de rechazados trae factura, motivo y su origen, la mas reciente primero (los sin respuesta no entran)", async () => {
  const d = (await pedir()).cuerpo.data;
  assert.equal(d.rechazados_total, 3);
  assert.deepEqual(d.rechazados_lista.map((r) => [r.origen, r.referencia, r.tipo, r.motivo]), [
    ["facturacion", numeroRechazada, "FACTURA_VENTA", "cuenta contable inexistente"], // 31/05 23:30
    ["gestion_caja", "DIF-9", "DIFERENCIA_CAJA", "cuenta de caja inexistente"], // 25/05
    ["facturacion", `ANU-${numeroAnulacion}`, "FACTURA_ANULACION", "Sin motivo informado"], // 20/05
  ]);
  assert.ok(d.rechazados_lista.every((r) => r.id && r.enviado_en));
  assert.equal((await pedir("?periodo=2008-05&limite=1")).cuerpo.data.rechazados_lista.length, 1);
  for (const malo of ["0", "201", "x"]) assert.equal((await pedir(`?periodo=2008-05&limite=${malo}`)).status, 400, malo);
});

test("solo cuentan los envios YA enviados y del mes en hora de Bolivia (Pendiente, Error y otros meses quedan fuera)", async () => {
  const d = (await pedir()).cuerpo.data;
  assert.equal(d.por_tipo.facturas.enviados, 7);
  const abril = (await pedir("?periodo=2008-04")).cuerpo.data;
  assert.deepEqual(abril.rechazados_lista.filter((r) => r.origen === "facturacion").map((r) => r.motivo), ["de abril"]);
  assert.deepEqual((await pedir("?periodo=2008-06")).cuerpo.data.rechazados_lista.filter((r) => r.origen === "facturacion").map((r) => r.motivo), ["de junio"]);
});

test("reenvia el token del administrador a Devoluciones y a Gestion de Caja", async () => {
  await pedir();
  assert.deepEqual(tokensRecibidos, ["Bearer ADMIN", "Bearer ADMIN"]);
});

test("Devoluciones caido: el % se calcula con lo que hay, su parte queda no disponible con su error y 'incompleto' avisa", async () => {
  nc = "caida";
  const d = (await pedir()).cuerpo.data;
  assert.deepEqual([d.enviados, d.registrados, d.incompleto], [9, 5, true]); // facturas 7 + diferencias 2
  assert.deepEqual([d.por_tipo.notas_credito.disponible, d.por_tipo.notas_credito.error], [false, "boom dev"]);
  assert.equal(d.por_tipo.diferencias_caja.disponible, true);
  dif = "caida";
  const dos = (await pedir()).cuerpo.data; // solo las facturas
  assert.deepEqual([dos.enviados, dos.registrados, dos.porcentaje], [7, 4, 57.14]);
  assert.equal(dos.por_tipo.diferencias_caja.error, "boom caja");
  process.env.DEVOLUCIONES_URL = "http://localhost:1";
  try {
    assert.match((await pedir()).cuerpo.data.por_tipo.notas_credito.error, /No se pudo conectar con Devoluciones/);
  } finally {
    process.env.DEVOLUCIONES_URL = `http://localhost:${devs.address().port}`;
  }
});

test("un mes sin asientos: porcentaje y color null (sin_asientos), todo en 0 y lista vacia", async () => {
  nc = datos(0, 0, 0);
  dif = datos(0, 0, 0);
  const d = (await pedir("?periodo=2008-09")).cuerpo.data;
  assert.deepEqual([d.enviados, d.registrados, d.rechazados, d.porcentaje, d.color, d.sin_asientos, d.rechazados_lista], [0, 0, 0, null, null, true, []]);
});

test("solo el administrador: sin token 401, cajero 403; periodo invalido 400; sin periodo usa el mes actual", async () => {
  assert.equal((await pedir("?periodo=2008-05", null)).status, 401);
  assert.equal((await pedir("?periodo=2008-05", "CAJERO")).status, 403);
  assert.equal((await pedir("?periodo=2008-13")).status, 400);
  const actual = await pedir("");
  assert.equal(actual.status, 200);
  assert.match(actual.cuerpo.data.periodo, /^\d{4}-\d{2}$/);
});
