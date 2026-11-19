// TDSI-139: GET /api/kpis/ventas-vs-meta. BD real: ventas de prueba insertadas DIRECTO en un mes lejano (julio de 2003) y borradas al
// terminar; Gestion de Caja (metas y validacion de administrador) es un servidor HTTP local.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/kpiRoutes");
const { ventanaDelGrafico, sumarDias } = require("../services/kpiService");

let caja, servidor, base;
let metas; // respuesta de /api/metas/resumen

const venta = (id, monto, fecha, estado = "Registrado") =>
  query(`INSERT INTO pagos.transacciones (id_transaccion, metodo, monto, tipo_pago, estado, fecha) VALUES ($1, 'Efectivo', $2, 'Simple', $3, $4::timestamptz)`, [id, monto, estado, fecha]);

test.before(async () => {
  caja = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/administradores/verificar") {
      return (req.headers.authorization || "") === "Bearer ADMIN" ? res.end(JSON.stringify({ ok: true, data: { administrador_id: "A" } })) : ((res.statusCode = 401), res.end(JSON.stringify({ ok: false, mensaje: "no" })));
    }
    if (req.url === "/api/metas/resumen") {
      if (metas === "caida") { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, mensaje: "boom" })); }
      return res.end(JSON.stringify({ ok: true, data: metas }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise((r) => caja.listen(0, r));
  process.env.GESTION_CAJA_URL = `http://localhost:${caja.address().port}`;
  delete process.env.ADMIN_VERIFICAR_URL;

  // julio de 2003: ventas el 1 (00:30), el 10 (dos ventas), el 31 (23:30) y una anulada el 10; ademas junio 30 23:50 y agosto 1 00:10 (fuera)
  await venta("KPI139-J1", 30, "2003-07-01 00:30:00-04"); // fuera de la ventana de 30 dias (empieza el 2)
  await venta("KPI139-J10A", 40, "2003-07-10 09:00:00-04");
  await venta("KPI139-J10B", 60.5, "2003-07-10 18:00:00-04");
  await venta("KPI139-J10X", 5000, "2003-07-10 12:00:00-04", "Anulado"); // anulada: no cuenta
  await venta("KPI139-J31", 80, "2003-07-31 23:30:00-04"); // ultimo dia (03:30Z del 1/8)
  await venta("KPI139-JUN", 999, "2003-06-30 23:50:00-04");
  await venta("KPI139-AGO", 999, "2003-08-01 00:10:00-04");

  const app = express();
  app.use(express.json());
  app.use("/api/kpis", rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis`;
});
test.beforeEach(() => { metas = { meta_diaria_total: 100, cajas_activas: 2, cajas_con_meta: 2, cajas: [] }; });
test.after(async () => {
  await query(`DELETE FROM pagos.transacciones WHERE id_transaccion LIKE 'KPI139-%'`);
  servidor.close();
  caja.close();
  await pool.end();
});

const pedir = (qs = "?periodo=2003-07", token = "ADMIN") => fetch(`${base}/ventas-vs-meta${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

test("30 dias terminando el ultimo dia del periodo, uno por dia, sin huecos y en orden", async () => {
  const { status, cuerpo } = await pedir();
  assert.equal(status, 200);
  const d = cuerpo.data;
  assert.deepEqual([d.periodo, d.desde, d.hasta, d.dias, d.serie.length], ["2003-07", "2003-07-02", "2003-07-31", 30, 30]);
  assert.deepEqual(d.serie.map((x) => x.fecha), Array.from({ length: 30 }, (_, i) => sumarDias("2003-07-02", i)));
});

test("los dias SIN ventas van en 0 y los dias con ventas suman lo vendido ese dia (hora de Bolivia)", async () => {
  const { serie } = (await pedir()).cuerpo.data;
  const por = Object.fromEntries(serie.map((x) => [x.fecha, x.ventas]));
  assert.equal(por["2003-07-10"], 100.5); // 40 + 60,50 (la anulada de 5000 no cuenta)
  assert.equal(por["2003-07-31"], 80); // 23:30 Bolivia del ultimo dia
  assert.equal(por["2003-07-02"], 0);
  assert.equal(por["2003-07-15"], 0);
  assert.equal(serie.filter((x) => x.ventas === 0).length, 28); // solo el 10 y el 31 tienen ventas
  assert.ok(!("2003-07-01" in por)); // la del dia 1 queda fuera de la ventana de 30 dias
  assert.ok(!("2003-08-01" in por));
});

test("el total del grafico es la suma de la serie (anuladas fuera)", async () => {
  const d = (await pedir()).cuerpo.data;
  assert.equal(d.total_vendido, 180.5);
  assert.equal(d.serie.reduce((a, x) => a + Math.round(x.ventas * 100), 0) / 100, 180.5);
});

test("la meta diaria es la suma de las cajas activas con meta; dias_sobre_meta cuenta los que la alcanzan", async () => {
  const d = (await pedir()).cuerpo.data;
  assert.deepEqual([d.meta_diaria, d.meta_error, d.dias_sobre_meta], [100, null, 1]); // solo el 10 (100,50) llega a Bs 100
  metas = { meta_diaria_total: 80, cajas_activas: 1, cajas_con_meta: 1, cajas: [] };
  assert.equal((await pedir()).cuerpo.data.dias_sobre_meta, 2); // el 10 y el 31 (80 justo)
});

test("sin metas cargadas o con Caja caida: meta null (sin linea roja), la serie sigue y se informa el motivo", async () => {
  metas = { meta_diaria_total: null, cajas_activas: 2, cajas_con_meta: 0, cajas: [] };
  const sin = (await pedir()).cuerpo.data;
  assert.deepEqual([sin.meta_diaria, sin.dias_sobre_meta, sin.serie.length], [null, null, 30]);
  metas = "caida";
  const caida = (await pedir()).cuerpo.data;
  assert.equal(caida.meta_diaria, null);
  assert.match(caida.meta_error, /boom|HTTP 500/);
  assert.equal(caida.serie.length, 30);
  assert.equal(caida.total_vendido, 180.5);
});

test("ventanaDelGrafico: el mes en curso termina HOY (Bolivia) y puede empezar en el mes anterior; un mes pasado termina su ultimo dia", () => {
  const ahora = new Date("2026-11-19T10:00:00Z"); // 19/11 06:00 en Bolivia
  assert.deepEqual([ventanaDelGrafico("2026-11", { ahora }).serie_desde, ventanaDelGrafico("2026-11", { ahora }).serie_hasta], ["2026-10-21", "2026-11-19"]);
  assert.equal(ventanaDelGrafico("2026-10", { ahora }).serie_hasta, "2026-10-31");
  assert.equal(ventanaDelGrafico("2026-10", { ahora }).serie_desde, "2026-10-02");
  // 02:00Z del 20/11 todavia es 19/11 en Bolivia
  assert.equal(ventanaDelGrafico("2026-11", { ahora: new Date("2026-11-20T02:00:00Z") }).serie_hasta, "2026-11-19");
  // un periodo futuro no se grafica "hacia adelante": se ancla al ultimo dia de ese mes
  assert.equal(ventanaDelGrafico("2027-02", { ahora }).serie_hasta, "2027-02-28");
  assert.equal(sumarDias("2026-03-01", -1), "2026-02-28");
});

test("periodo invalido da 400 y sin periodo usa el mes actual; solo el administrador (401 sin token)", async () => {
  assert.equal((await pedir("?periodo=2003-13")).status, 400);
  const actual = await pedir("");
  assert.equal(actual.status, 200);
  assert.equal(actual.cuerpo.data.serie.length, 30);
  assert.equal((await pedir("?periodo=2003-07", null)).status, 401);
  assert.equal((await pedir("?periodo=2003-07", "otro")).status, 401);
});
