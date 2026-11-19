// TDSI-151: GET /api/kpis/anulaciones/por-cajero. BD real en un mes lejano (marzo de 2001): ventas insertadas DIRECTO y borradas al
// terminar; la validacion de administrador es un Gestion de Caja local.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/kpiRoutes");
const { anulacionesPorCajero } = require("../services/kpiService");

let caja, servidor, base;

const venta = (id, cajeroId, nombre, fecha, estado = "Registrado", metodo = "Efectivo", tipo = "Simple") =>
  query(
    `INSERT INTO pagos.transacciones (id_transaccion, metodo, monto, tipo_pago, estado, fecha, cajero, cajero_id, cajero_nombre) VALUES ($1, $2, 10, $3, $4, $5::timestamptz, $6, $7, $8)`,
    [id, metodo, tipo, estado, fecha, cajeroId, cajeroId, nombre]
  );

test.before(async () => {
  caja = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if ((req.headers.authorization || "") === "Bearer ADMIN") return res.end(JSON.stringify({ ok: true, data: { administrador_id: "A" } }));
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, mensaje: "no" }));
  });
  await new Promise((r) => caja.listen(0, r));
  process.env.ADMIN_VERIFICAR_URL = `http://localhost:${caja.address().port}`;

  // marzo de 2001: Ana anula 3 de 10 emitidas; Beto 1 de 2; Carla ninguna (no sale); un mixto anulado de Beto cuenta UNA vez
  for (let i = 0; i < 7; i++) await venta(`KPI151-AV${i}`, "ana@x.com", "Ana Perez", "2001-03-05 10:00:00-04");
  for (let i = 0; i < 3; i++) await venta(`KPI151-AA${i}`, "ana@x.com", "Ana Perez", "2001-03-06 10:00:00-04", "Anulado");
  await venta("KPI151-BV", "beto@x.com", "Beto Rojas", "2001-03-07 10:00:00-04");
  await venta("KPI151-BM", "beto@x.com", "Beto Rojas", "2001-03-08 10:00:00-04", "Anulado", "Efectivo", "Mixto");
  await venta("KPI151-BM", "beto@x.com", "Beto Rojas", "2001-03-08 10:00:00-04", "Anulado", "QR", "Mixto");
  for (let i = 0; i < 4; i++) await venta(`KPI151-CV${i}`, "carla@x.com", "Carla Soto", "2001-03-09 10:00:00-04");
  // fuera del mes (hora de Bolivia): 23:50 del 28/02 y 00:10 del 1/04
  await venta("KPI151-FUERA1", "ana@x.com", "Ana Perez", "2001-02-28 23:50:00-04", "Anulado");
  await venta("KPI151-FUERA2", "ana@x.com", "Ana Perez", "2001-04-01 00:10:00-04", "Anulado");
  // sin nombre registrado: sale con su identificador
  await query(`INSERT INTO pagos.transacciones (id_transaccion, metodo, monto, tipo_pago, estado, fecha, cajero, cajero_id) VALUES ('KPI151-SN', 'QR', 10, 'Simple', 'Anulado', '2001-03-10 10:00:00-04', 'dani@x.com', 'dani@x.com')`);

  const app = express();
  app.use(express.json());
  app.use("/api/kpis", rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis`;
});
test.after(async () => {
  await query(`DELETE FROM pagos.transacciones WHERE id_transaccion LIKE 'KPI151-%'`);
  delete process.env.ADMIN_VERIFICAR_URL;
  servidor.close();
  caja.close();
  await pool.end();
});

const pedir = (qs = "?periodo=2001-03", token = "ADMIN") => fetch(`${base}/anulaciones/por-cajero${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

test("cada cajero con su cantidad anulada y su % del total, de mayor a menor (el mixto cuenta una vez)", async () => {
  const { status, cuerpo } = await pedir();
  assert.equal(status, 200);
  const d = cuerpo.data;
  assert.deepEqual([d.periodo, d.desde, d.hasta, d.total_anuladas], ["2001-03", "2001-03-01", "2001-03-31", 5]);
  assert.deepEqual(d.cajeros.map((c) => [c.cajero, c.anuladas, c.porcentaje]), [
    ["Ana Perez", 3, 60],
    ["Beto Rojas", 1, 20],
    ["dani@x.com", 1, 20],
  ]);
});

test("ademas de su % del total, cada cajero trae su propia tasa (anuladas / emitidas por el)", async () => {
  const d = (await pedir()).cuerpo.data;
  const ana = d.cajeros.find((c) => c.cajero === "Ana Perez");
  assert.deepEqual([ana.anuladas, ana.emitidas, ana.tasa], [3, 10, 30]);
  const beto = d.cajeros.find((c) => c.cajero === "Beto Rojas");
  assert.deepEqual([beto.anuladas, beto.emitidas, beto.tasa], [1, 2, 50]);
});

test("quien no anulo nada no aparece, y las anulaciones fuera del mes (hora de Bolivia) no cuentan", async () => {
  const d = await anulacionesPorCajero({ periodo: "2001-03" });
  assert.ok(!d.cajeros.some((c) => c.cajero === "Carla Soto"));
  assert.equal(d.cajeros.find((c) => c.cajero === "Ana Perez").anuladas, 3); // sin las del 28/02 23:50 ni 1/04 00:10
  assert.equal((await anulacionesPorCajero({ periodo: "2001-02" })).cajeros.find((c) => c.cajero === "Ana Perez").anuladas, 1);
  assert.equal((await anulacionesPorCajero({ periodo: "2001-04" })).cajeros.find((c) => c.cajero === "Ana Perez").anuladas, 1);
});

test("el orden es de mayor a menor y el empate se resuelve por nombre", async () => {
  const d = await anulacionesPorCajero({ periodo: "2001-03" });
  const cant = d.cajeros.map((c) => c.anuladas);
  assert.deepEqual(cant, [...cant].sort((a, b) => b - a));
  assert.deepEqual(d.cajeros.slice(1).map((c) => c.cajero), ["Beto Rojas", "dani@x.com"]); // empatados con 1: B antes que d
});

test("un mes sin anulaciones: lista vacia y total 0 (nunca NaN)", async () => {
  const d = (await pedir("?periodo=2001-08")).cuerpo.data;
  assert.deepEqual([d.total_anuladas, d.cajeros], [0, []]);
});

test("solo el administrador (401 sin token), periodo invalido 400 y sin periodo usa el mes actual", async () => {
  assert.equal((await pedir("?periodo=2001-03", null)).status, 401);
  assert.equal((await pedir("?periodo=2001-03", "otro")).status, 401);
  assert.equal((await pedir("?periodo=2001-13")).status, 400);
  const actual = await pedir("");
  assert.equal(actual.status, 200);
  assert.match(actual.cuerpo.data.periodo, /^\d{4}-\d{2}$/);
});
