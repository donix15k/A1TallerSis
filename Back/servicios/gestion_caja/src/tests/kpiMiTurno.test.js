// TDSI-219/220/221/222: GET /api/kpis/mi-turno y POST /api/kpis/mi-turno/cierre (la pantalla "Mi turno" del cajero). BD y Supabase Auth reales:
// 3 cuentas de cajero de prueba (con turno abierto, con otro turno y sin turno) que se borran al terminar; Gestion de Pagos (ventas del turno y
// rangos del semaforo) es un servidor HTTP local. El cajero solo ve SU turno: se prueba que B no puede ver el de A.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const { requireCajero } = require("../middlewares/requireCajero");
const { crearCajero } = require("../services/adminUsuariosService");
const { autenticarCajero } = require("../services/authService");
const { reiniciarCache } = require("../services/objetivosProxy");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PREFIJO = `tdsi219-${Date.now()}`;
const CAJA_A = "CAJA-T219A";
const CAJA_B = "CAJA-T219B";
const cuentasCreadas = [];
let pagos, servidor, base;
let validarEfectivoContado; // se carga despues de fijar GESTION_PAGOS_URL (pagosProxy la lee al cargar el modulo)
let pagosCaido = false; // Gestion de Pagos responde 500
let semaforo; // lo que responde Gestion de Pagos en /api/kpis/semaforo: lista de indicadores, o "caida"
let tokens = {}; // A, B, C -> access_token
let cuentas = {}; // A, B, C -> { email, cajero_id }

// Lo que Gestion de Pagos dice vendio cada caja. El mismo reporte sirve para el turno y para el dia (se distinguen por "desde").
const VENTAS = {
  [CAJA_A]: { totalGeneral: 610, totalEfectivo: 400, totalTarjeta: 100, totalQR: 110, totalVale: 0, totalDigital: 210, cantidadVentas: 14, cantidadAnuladas: 1, montoAnulado: 30, operacionesPorMetodo: { Efectivo: 8, Tarjeta: 3, QR: 3, Vale: 0 } },
  [CAJA_B]: { totalGeneral: 99, totalEfectivo: 99, totalTarjeta: 0, totalQR: 0, totalVale: 0, totalDigital: 0, cantidadVentas: 3, cantidadAnuladas: 0, montoAnulado: 0, operacionesPorMetodo: { Efectivo: 3, Tarjeta: 0, QR: 0, Vale: 0 } },
};

async function cuenta(letra, nombre) {
  const usuario = `${PREFIJO}-${letra}@test.com`;
  const cajero = await crearCajero({ usuario, password: "clave123", nombre });
  cuentasCreadas.push(cajero.cajero_id);
  cuentas[letra] = { email: usuario, cajero_id: cajero.cajero_id };
  tokens[letra] = (await autenticarCajero({ email: usuario, password: "clave123" })).access_token;
}

const limpiar = async () => {
  await query(`DELETE FROM caja.turnos WHERE codigo LIKE 'T219-%'`);
  await query(`DELETE FROM caja.metas_venta WHERE caja_id = ANY($1)`, [[CAJA_A, CAJA_B]]);
  await query(`DELETE FROM caja.cajas WHERE codigo = ANY($1)`, [[CAJA_A, CAJA_B]]);
};

test.before(async () => {
  pagos = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/kpis/semaforo") {
      if (semaforo === "caida") { res.statusCode = 500; return res.end("{}"); }
      return res.end(JSON.stringify({ ok: true, data: { indicadores: semaforo } }));
    }
    if (url.pathname === "/api/pagos/reporte-turno") {
      if (pagosCaido) { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, mensaje: "boom pagos" })); }
      const datos = VENTAS[url.searchParams.get("caja_id")];
      if (!datos) { res.statusCode = 404; return res.end(JSON.stringify({ ok: false, mensaje: "caja sin ventas" })); }
      return res.end(JSON.stringify({ ok: true, data: datos }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((r) => pagos.listen(0, r));
  process.env.GESTION_PAGOS_URL = `http://localhost:${pagos.address().port}`;
  process.env.OBJETIVOS_TTL_MS = "0"; // sin cache: cada consulta lee los rangos vigentes
  ({ validarEfectivoContado } = require("../services/miTurnoService"));
  const miTurnoRoutes = require("../routes/miTurnoRoutes");

  await limpiar();
  await query(`INSERT INTO caja.cajas (codigo, nombre, estado) VALUES ($1, 'Terminal T219 A', 'ACTIVA'), ($2, 'Terminal T219 B', 'ACTIVA')`, [CAJA_A, CAJA_B]);
  await query(`INSERT INTO caja.metas_venta (caja_id, monto_meta) VALUES ($1, 1000)`, [CAJA_A]); // B no tiene meta
  await cuenta("A", "Ana Cajera");
  await cuenta("B", "Beto Cajero");
  await cuenta("C", "Carla Sin Turno");
  // cajero_id del turno es el correo con el que abrio sesion
  await query(`INSERT INTO caja.turnos (codigo, caja_id, cajero_id, efectivo_inicial, estado) VALUES ('T219-A', $1, $2, 100, 'ABIERTO'), ('T219-B', $3, $4, 50, 'ABIERTO')`, [CAJA_A, cuentas.A.email, CAJA_B, cuentas.B.email.toUpperCase()]); // el de B con el correo en MAYUSCULAS: igual es su turno

  const app = express();
  app.use(express.json());
  app.use("/api/kpis/mi-turno", requireCajero, miTurnoRoutes);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis/mi-turno`;
});
test.beforeEach(() => {
  pagosCaido = false;
  reiniciarCache();
  semaforo = [{ indicador: "cumplimiento_metas", verde: 100, amarillo: 70, rojo: 0, sentido: "MAYOR" }];
});
test.after(async () => {
  delete process.env.OBJETIVOS_TTL_MS;
  pagos.close();
  servidor.close();
  for (const cajero_id of cuentasCreadas) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${cajero_id}`, { method: "DELETE", headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } });
  }
  await query(`DELETE FROM caja.cajeros WHERE usuario LIKE $1`, [`${PREFIJO}%`]);
  await limpiar();
  await pool.end();
});

const pedir = (metodo, ruta, { token, cuerpo, qs = "" } = {}) =>
  fetch(`${base}${ruta}${qs}`, { method: metodo, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

// ---------------------------------------------------------------- TDSI-220 / 221
test("sin token o con un token falso: 401", async () => {
  assert.equal((await pedir("GET", "")).status, 401);
  assert.equal((await pedir("GET", "", { token: "no-es-un-token" })).status, 401);
  assert.equal((await pedir("POST", "/cierre", { cuerpo: { efectivo_contado: 1 } })).status, 401);
});

test("Mi turno: los numeros del turno (ventas, ticket promedio, anulaciones) del cajero que inicio sesion", async () => {
  const { status, cuerpo } = await pedir("GET", "", { token: tokens.A });
  assert.equal(status, 200);
  const d = cuerpo.data;
  assert.deepEqual([d.turno.codigo, d.turno.caja_id, d.turno.caja_nombre, d.turno.cajero, d.turno.efectivo_inicial], ["T219-A", CAJA_A, "Terminal T219 A", "Ana Cajera", 100]);
  assert.deepEqual(d.numeros, { ventas: 14, ticket_promedio: 43.57, anulaciones: 1, total_vendido: 610 }); // 610 / 14
  assert.equal(d.avisos.length, 3);
  assert.ok(d.avisos.includes("Cuenta el efectivo dos veces antes de cerrar."));
});

test("Mi meta de hoy: lo vendido hoy en la caja contra su meta, el % y el color del semaforo (61 % = ROJO)", async () => {
  const d = (await pedir("GET", "", { token: tokens.A })).cuerpo.data;
  assert.deepEqual([d.meta_hoy.vendido, d.meta_hoy.meta, d.meta_hoy.porcentaje, d.meta_hoy.color], [610, 1000, 61, "ROJO"]);
  assert.deepEqual(d.meta_hoy.umbrales, { verde: 100, amarillo: 70 });
  assert.match(d.meta_hoy.fecha, /^\d{4}-\d{2}-\d{2}$/);
});

test("el color de la meta usa los rangos vigentes del panel: con 'verde desde 50' el 61 % es VERDE", async () => {
  semaforo = [{ indicador: "cumplimiento_metas", verde: 50, amarillo: 30, rojo: 0, sentido: "MAYOR" }];
  const d = (await pedir("GET", "", { token: tokens.A })).cuerpo.data;
  assert.deepEqual([d.meta_hoy.porcentaje, d.meta_hoy.color, d.meta_hoy.umbrales], [61, "VERDE", { verde: 50, amarillo: 30 }]);
  semaforo = "caida"; // sin los rangos del panel: los iniciales
  reiniciarCache();
  assert.equal((await pedir("GET", "", { token: tokens.A })).cuerpo.data.meta_hoy.color, "ROJO");
});

test("una caja sin meta cargada: meta, % y color null (no hay contra que comparar)", async () => {
  const d = (await pedir("GET", "", { token: tokens.B })).cuerpo.data;
  assert.deepEqual([d.meta_hoy.vendido, d.meta_hoy.meta, d.meta_hoy.porcentaje, d.meta_hoy.color], [99, null, null, null]);
});

test("el efectivo esperado lo calcula el sistema: efectivo inicial + ventas en efectivo - salidas (100 + 400 = 500)", async () => {
  const d = (await pedir("GET", "", { token: tokens.A })).cuerpo.data;
  assert.deepEqual(d.cierre, { efectivo_esperado: 500, efectivo_inicial: 100, ventas_efectivo: 400, egresos_efectivo: 0 });
});

test("cada cajero ve SOLO su turno: B ve el suyo, y pidiendo la caja de A (?caja_id) no ve nada de A", async () => {
  const b = (await pedir("GET", "", { token: tokens.B })).cuerpo.data;
  assert.deepEqual([b.turno.codigo, b.turno.cajero, b.numeros.ventas, b.numeros.total_vendido], ["T219-B", "Beto Cajero", 3, 99]);
  const espiando = (await pedir("GET", "", { token: tokens.B, qs: `?caja_id=${CAJA_A}` })).cuerpo.data;
  assert.equal(espiando.turno, null); // la caja de A no es suya
  assert.equal(espiando.numeros, undefined);
  assert.ok(!JSON.stringify(espiando).includes("T219-A"));
});

test("sin turno abierto: 200 con el mensaje 'Abra su turno para ver sus indicadores' (y los avisos)", async () => {
  const { status, cuerpo } = await pedir("GET", "", { token: tokens.C });
  assert.equal(status, 200);
  assert.deepEqual([cuerpo.data.turno, cuerpo.data.mensaje], [null, "Abra su turno para ver sus indicadores"]);
  assert.equal(cuerpo.data.numeros, undefined);
  assert.equal(cuerpo.data.avisos.length, 3);
});

test("un turno CERRADO no cuenta como turno abierto", async () => {
  await query(`UPDATE caja.turnos SET estado = 'CERRADO', cerrado_en = now() WHERE codigo = 'T219-B'`);
  try {
    assert.equal((await pedir("GET", "", { token: tokens.B })).cuerpo.data.turno, null);
  } finally {
    await query(`UPDATE caja.turnos SET estado = 'ABIERTO', cerrado_en = NULL WHERE codigo = 'T219-B'`);
  }
});

test("si Gestion de Pagos falla: error de servidor con su mensaje (no inventa numeros)", async () => {
  pagosCaido = true;
  const r = await pedir("GET", "", { token: tokens.A });
  assert.ok(r.status >= 500, `debe ser un error de servidor, fue ${r.status}`);
  assert.match(r.cuerpo.mensaje, /boom pagos|reporte de ventas/);
  assert.equal(r.cuerpo.data, undefined); // no inventa numeros
});

// ---------------------------------------------------------------- TDSI-222
test("la fila Diferencia: CUADRA cuando el efectivo contado es el esperado (Bs 0,00 · CUADRA)", async () => {
  const { status, cuerpo } = await pedir("POST", "/cierre", { token: tokens.A, cuerpo: { efectivo_contado: 500 } });
  assert.equal(status, 200);
  assert.deepEqual([cuerpo.data.efectivo_esperado, cuerpo.data.efectivo_contado, cuerpo.data.diferencia, cuerpo.data.estado, cuerpo.data.cuadra], [500, 500, 0, "CUADRA", true]);
});

test("SOBRA si contó de más y FALTA si contó de menos, con la diferencia con signo (contado - esperado)", async () => {
  const sobra = (await pedir("POST", "/cierre", { token: tokens.A, cuerpo: { efectivo_contado: "520.50" } })).cuerpo.data;
  assert.deepEqual([sobra.diferencia, sobra.estado, sobra.tipo_diferencia, sobra.cuadra], [20.5, "SOBRA", "SOBRANTE", false]);
  const falta = (await pedir("POST", "/cierre", { token: tokens.A, cuerpo: { efectivo_contado: 480 } })).cuerpo.data;
  assert.deepEqual([falta.diferencia, falta.estado, falta.tipo_diferencia], [-20, "FALTA", "FALTANTE"]);
  const centavo = (await pedir("POST", "/cierre", { token: tokens.A, cuerpo: { efectivo_contado: 499.99 } })).cuerpo.data;
  assert.deepEqual([centavo.diferencia, centavo.estado], [-0.01, "FALTA"]);
});

test("reutiliza el arqueo que ya existe: por billetes y monedas (5 de Bs 100 = 500 = CUADRA)", async () => {
  const { status, cuerpo } = await pedir("POST", "/cierre", { token: tokens.A, cuerpo: { arqueo: [{ denominacion: 100, cantidad: 4 }, { denominacion: 50, cantidad: 2 }] } });
  assert.equal(status, 200);
  assert.deepEqual([cuerpo.data.efectivo_contado, cuerpo.data.estado], [500, "CUADRA"]);
  assert.deepEqual(cuerpo.data.denominaciones.map((f) => [f.denominacion, f.cantidad, f.subtotal]), [[100, 4, 400], [50, 2, 100]]);
  assert.equal((await pedir("POST", "/cierre", { token: tokens.A, cuerpo: { arqueo: [{ denominacion: 7, cantidad: 1 }] } })).status, 400); // no es un billete de Bs
});

test("un efectivo contado invalido es 400 y no se calcula nada", async () => {
  for (const malo of [-1, "abc", "", null, 500.123, 1e15, true]) {
    assert.equal((await pedir("POST", "/cierre", { token: tokens.A, cuerpo: { efectivo_contado: malo } })).status, 400, String(malo));
  }
  assert.equal((await pedir("POST", "/cierre", { token: tokens.A, cuerpo: {} })).status, 400);
  assert.equal(validarEfectivoContado("0"), 0);
  assert.equal(validarEfectivoContado(12.5), 12.5);
});

test("sin turno abierto el cierre es 404 'Abra su turno'; y calcular la diferencia NO cierra el turno", async () => {
  const c = await pedir("POST", "/cierre", { token: tokens.C, cuerpo: { efectivo_contado: 10 } });
  assert.equal(c.status, 404);
  assert.match(c.cuerpo.mensaje, /Abra su turno/);
  await pedir("POST", "/cierre", { token: tokens.A, cuerpo: { efectivo_contado: 500 } });
  const { rows } = await query(`SELECT estado FROM caja.turnos WHERE codigo = 'T219-A'`);
  assert.equal(rows[0].estado, "ABIERTO");
});

test("el cierre tambien es solo del cajero que inicio sesion: el de B se calcula con el turno de B (50 + 99 = 149)", async () => {
  const r = (await pedir("POST", "/cierre", { token: tokens.B, cuerpo: { efectivo_contado: 149 } })).cuerpo.data;
  assert.deepEqual([r.caja_id, r.efectivo_esperado, r.estado], [CAJA_B, 149, "CUADRA"]);
});
