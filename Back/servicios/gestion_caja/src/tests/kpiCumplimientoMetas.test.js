// TDSI-159/160/161: GET /api/kpis/cumplimiento-metas. BD real (cajas y metas de prueba, borradas al terminar); Gestion de Pagos (lo
// vendido por caja) es un servidor HTTP local que se inyecta ANTES de cargar los servicios.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");

let pagos, vendidoPorCaja, pedidos;
let servidor, base, servidorProtegido, baseProtegida;
let query, cumplimientoMetas, colorCumplimiento, metaDelMes, rangoDelPeriodo;

const A = "CAJA-T159A"; // meta mensual
const B = "CAJA-T159B"; // solo meta diaria
const C = "CAJA-T159C"; // sin meta
const D = "CAJA-T159D"; // inactiva con meta
const cajasDePrueba = [A, B, C, D];

test.before(async () => {
  pagos = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const cajaId = url.searchParams.get("caja_id");
    pedidos.push({ caja_id: cajaId, desde: url.searchParams.get("desde"), hasta: url.searchParams.get("hasta") });
    const total = vendidoPorCaja[cajaId] ?? 0;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, data: { totalGeneral: total, totalEfectivo: total, totalTarjeta: 0, totalQR: 0, cantidadVentas: total ? 1 : 0, operacionesPorMetodo: { Efectivo: 0, Tarjeta: 0, QR: 0 } } }));
  });
  await new Promise((r) => pagos.listen(0, r));
  process.env.GESTION_PAGOS_URL = `http://localhost:${pagos.address().port}`;

  ({ query } = require("../config/db"));
  ({ cumplimientoMetas, colorCumplimiento, metaDelMes } = require("../services/kpiMetasService"));
  ({ rangoDelPeriodo } = require("../utils/periodo"));
  const { errorHandler } = require("../middlewares/errorHandler");
  const { requireAdministrador } = require("../middlewares/requireAdministrador");
  const rutas = require("../routes/kpiRoutes");

  await limpiar();
  await query(
    `INSERT INTO caja.cajas (codigo, nombre, estado) VALUES ($1, 'T159 A', 'ACTIVA'), ($2, 'T159 B', 'ACTIVA'), ($3, 'T159 C', 'ACTIVA'), ($4, 'T159 D', 'INACTIVA')`,
    cajasDePrueba
  );
  await query(`INSERT INTO caja.metas_mensuales (caja_id, monto_mensual) VALUES ($1, 10000)`, [A]);
  await query(`INSERT INTO caja.metas_venta (caja_id, monto_meta) VALUES ($1, 100), ($2, 777), ($3, 5)`, [B, D, A]); // A tiene diaria Y mensual: gana la mensual

  const app = express();
  app.use(express.json());
  app.use("/api/kpis", rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis/cumplimiento-metas`;

  const protegida = express();
  protegida.use("/api/kpis", requireAdministrador, rutas);
  protegida.use(errorHandler);
  servidorProtegido = await new Promise((r) => { const s = protegida.listen(0, () => r(s)); });
  baseProtegida = `http://localhost:${servidorProtegido.address().port}/api/kpis/cumplimiento-metas`;
});
test.beforeEach(() => {
  vendidoPorCaja = {};
  pedidos = [];
});
test.after(async () => {
  servidor.close();
  servidorProtegido.close();
  pagos.close();
  await limpiar();
  await require("../config/db").pool.end();
});

async function limpiar() {
  await query(`DELETE FROM caja.metas_mensuales WHERE caja_id = ANY($1)`, [cajasDePrueba]);
  await query(`DELETE FROM caja.metas_venta WHERE caja_id = ANY($1)`, [cajasDePrueba]);
  await query(`DELETE FROM caja.cajas WHERE codigo = ANY($1)`, [cajasDePrueba]);
}

const pedir = (qs = "?periodo=2001-02") => fetch(`${base}${qs}`).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));
const mias = (d) => d.cajas.filter((c) => cajasDePrueba.includes(c.caja_id));

test("semaforo: VERDE desde 100 %, AMARILLO de 70 a 99,99 %, ROJO por debajo de 70 %", () => {
  const casos = [[150, "VERDE"], [100, "VERDE"], [99.99, "AMARILLO"], [86, "AMARILLO"], [70, "AMARILLO"], [69.99, "ROJO"], [61, "ROJO"], [0, "ROJO"]];
  for (const [pct, color] of casos) assert.equal(colorCumplimiento(pct), color, String(pct));
});

test("la meta del mes: la mensual si existe; si no, la diaria por los dias del mes; sin ninguna, null", () => {
  assert.deepEqual(metaDelMes(10000, 100, 28), { monto: 1000000, origen: "mensual" });
  assert.deepEqual(metaDelMes(null, 100, 28), { monto: 280000, origen: "diaria_por_dias" });
  assert.deepEqual(metaDelMes(undefined, undefined, 28), { monto: null, origen: null });
});

test("el periodo: AAAA-MM con sus dias (febrero 2001 = 28, febrero 2004 = 29); invalido 400", () => {
  assert.deepEqual(rangoDelPeriodo("2001-02"), { periodo: "2001-02", desde: "2001-02-01", hasta: "2001-02-28", dias: 28 });
  assert.equal(rangoDelPeriodo("2004-02").dias, 29);
  assert.equal(rangoDelPeriodo(undefined, { hoy: "2026-11-19" }).periodo, "2026-11");
  for (const malo of ["2001-13", "febrero", "2001-2", "2001-02-01"]) assert.throws(() => rangoDelPeriodo(malo), (e) => e.status === 400, malo);
});

test("cada caja activa con lo vendido, su meta, su % y su color; la inactiva no aparece", async () => {
  vendidoPorCaja = { [A]: 10700, [B]: 2324 };
  const { status, cuerpo } = await pedir();
  assert.equal(status, 200);
  const d = cuerpo.data;
  assert.deepEqual([d.periodo, d.desde, d.hasta], ["2001-02", "2001-02-01", "2001-02-28"]);
  assert.deepEqual(mias(d).map((c) => [c.caja_id, c.vendido, c.meta, c.porcentaje, c.color, c.meta_origen]), [
    [A, 10700, 10000, 107, "VERDE", "mensual"], // gana la mensual (10000), no la diaria (5 x 28)
    [B, 2324, 2800, 83, "AMARILLO", "diaria_por_dias"], // 100 x 28 dias
    [C, 0, null, null, null, null], // sin meta: se informa, sin % ni color
  ]);
  assert.ok(!mias(d).some((c) => c.caja_id === D));
  assert.deepEqual(d.umbrales, { verde: 100, amarillo: 70 });
});

test("los limites del color por caja: 70 % justo es AMARILLO y 69,99 % es ROJO; 100 % justo es VERDE", async () => {
  vendidoPorCaja = { [A]: 7000, [B]: 1959.72 }; // 70 % y 69,99 % de 2800
  const d = (await pedir()).cuerpo.data;
  const por = Object.fromEntries(mias(d).map((c) => [c.caja_id, c]));
  assert.deepEqual([por[A].porcentaje, por[A].color, por[B].porcentaje, por[B].color], [70, "AMARILLO", 69.99, "ROJO"]);
  vendidoPorCaja = { [A]: 10000 };
  assert.equal(mias((await pedir()).cuerpo.data).find((c) => c.caja_id === A).color, "VERDE");
});

test("el % general = lo vendido de las cajas con meta / la suma de sus metas (la caja sin meta no cuenta)", async () => {
  vendidoPorCaja = { [A]: 10700, [B]: 2324, [C]: 99999 }; // C vende mucho pero no tiene meta: no entra
  const d = (await pedir()).cuerpo.data;
  const conMeta = d.cajas.filter((c) => c.meta !== null);
  const vendido = conMeta.reduce((a, c) => a + Math.round(c.vendido * 100), 0) / 100;
  const meta = conMeta.reduce((a, c) => a + Math.round(c.meta * 100), 0) / 100;
  assert.deepEqual([d.general.vendido, d.general.meta, d.general.cajas_con_meta], [vendido, meta, conMeta.length]);
  assert.equal(d.general.porcentaje, Math.round((vendido / meta) * 10000) / 100);
  assert.equal(d.general.color, colorCumplimiento(d.general.porcentaje));
  assert.ok(!conMeta.some((c) => c.caja_id === C));
});

test("sin ventas en el mes todas las cajas con meta quedan en 0 % ROJO (nunca NaN)", async () => {
  const d = (await pedir()).cuerpo.data;
  for (const c of mias(d).filter((x) => x.meta !== null)) assert.deepEqual([c.vendido, c.porcentaje, c.color], [0, 0, "ROJO"]);
  assert.ok(Number.isFinite(d.general.porcentaje));
});

test("lo vendido se pide a Pagos con el mes completo en hora de Bolivia (00:00 del dia 1 a 23:59:59.999 del ultimo)", async () => {
  await pedir();
  const p = pedidos.find((x) => x.caja_id === A);
  assert.equal(p.desde, "2001-02-01T04:00:00.000Z"); // 00:00 Bolivia = 04:00Z
  assert.equal(p.hasta, "2001-03-01T03:59:59.999Z"); // 23:59:59.999 del 28/02 Bolivia
});

test("periodo invalido 400; sin periodo usa el mes actual; sin token 401 (solo el administrador)", async () => {
  assert.equal((await pedir("?periodo=2001-13")).status, 400);
  const actual = await pedir("");
  assert.equal(actual.status, 200);
  assert.match(actual.cuerpo.data.periodo, /^\d{4}-\d{2}$/);
  assert.equal((await fetch(baseProtegida)).status, 401);
  assert.equal((await fetch(baseProtegida, { headers: { Authorization: "Bearer no-es-un-token" } })).status, 401);
});
