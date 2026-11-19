// TDSI-138: GET /api/kpis/resumen. BD real: las ventas de prueba se insertan DIRECTO en un mes lejano (abril de 2003, para no
// mezclarse con ventas reales) y se borran al terminar; el administrador se valida contra un Gestion de Caja local.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/kpiRoutes");

const PERIODO = "2003-04";
let caja, devs, servidor, base;

// Horas de Bolivia (UTC-4): "2003-04-01 00:30 -04" etc.
const venta = (id, metodo, monto, fecha, estado = "Registrado", tipo = "Simple") =>
  query(`INSERT INTO pagos.transacciones (id_transaccion, metodo, monto, tipo_pago, estado, fecha) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`, [id, metodo, monto, tipo, estado, fecha]);

test.before(async () => {
  caja = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (token === "ADMIN") return res.end(JSON.stringify({ ok: true, data: { administrador_id: "A", nombre: "Admin" } }));
    res.statusCode = token === "CAJERO" ? 403 : 401;
    res.end(JSON.stringify({ ok: false, mensaje: token === "CAJERO" ? "Esta accion requiere permisos de Administrador." : "Token invalido o vencido" }));
  });
  await new Promise((r) => caja.listen(0, r));
  process.env.ADMIN_VERIFICAR_URL = `http://localhost:${caja.address().port}`;
  devs = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, data: { monto_devuelto: 0, cantidad: 0, motivos: [] } }));
  });
  await new Promise((r) => devs.listen(0, r));
  process.env.DEVOLUCIONES_URL = `http://localhost:${devs.address().port}`;

  // 3 ventas validas: 40,00 + 50,00 (mixto 20 + 30) + 49,14 = 139,14 -> ticket promedio 46,38 (VERDE)
  await venta("KPI138-S1", "Efectivo", 40, "2003-04-01 00:30:00-04"); // primer dia del mes (00:30 Bolivia)
  await venta("KPI138-S2", "Efectivo", 20, "2003-04-15 10:00:00-04", "Registrado", "Mixto");
  await venta("KPI138-S2", "QR", 30, "2003-04-15 10:00:00-04", "Registrado", "Mixto");
  await venta("KPI138-S3", "QR", 49.14, "2003-04-30 23:30:00-04"); // ultimo dia del mes (23:30 Bolivia = 03:30Z del 1/5)
  await venta("KPI138-ANU", "Efectivo", 1000, "2003-04-10 09:00:00-04", "Anulado"); // anulada: no cuenta
  await venta("KPI138-ANTES", "Efectivo", 999, "2003-03-31 23:50:00-04"); // marzo
  await venta("KPI138-DESPUES", "Efectivo", 999, "2003-05-01 00:10:00-04"); // mayo

  const app = express();
  app.use(express.json());
  app.use("/api/kpis", rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis`;
});
test.after(async () => {
  await query(`DELETE FROM pagos.transacciones WHERE id_transaccion LIKE 'KPI138-%'`);
  delete process.env.ADMIN_VERIFICAR_URL;
  servidor.close();
  caja.close();
  devs.close();
  delete process.env.DEVOLUCIONES_URL;
  await pool.end();
});

const pedir = (qs = "", token = "ADMIN") => fetch(`${base}/resumen${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

test("el resumen del mes trae la tarjeta Ticket promedio con su valor, su color y el detalle", async () => {
  const { status, cuerpo } = await pedir(`?periodo=${PERIODO}`);
  assert.equal(status, 200);
  const d = cuerpo.data;
  assert.deepEqual([d.periodo, d.desde, d.hasta], [PERIODO, "2003-04-01", "2003-04-30"]);
  assert.deepEqual(d.tarjetas.map((x) => x.id), ["ticket_promedio", "anulacion", "devoluciones"]);
  const [t] = d.tarjetas;
  assert.deepEqual([t.id, t.nombre, t.valor, t.unidad, t.color], ["ticket_promedio", "Ticket promedio", 46.38, "Bs", "VERDE"]);
  assert.deepEqual([t.detalle.total_vendido, t.detalle.ventas_validas, t.detalle.ventas_anuladas, t.detalle.sin_ventas], [139.14, 3, 1, false]);
  assert.deepEqual(t.detalle.umbrales, { verde: 45, amarillo: 35 });
});

test("el pago mixto cuenta como UNA venta (no una por metodo) y las anuladas no cuentan", async () => {
  const t = (await pedir(`?periodo=${PERIODO}`)).cuerpo.data.tarjetas[0];
  assert.equal(t.detalle.ventas_validas, 3); // S1, S2 (mixto) y S3
  assert.equal(t.detalle.total_vendido, 139.14); // sin los 1000 de la anulada
});

test("el limite del mes es hora de Bolivia: lo vendido a las 23:30 del ultimo dia entra; a las 00:10 del dia siguiente no", async () => {
  const abril = (await pedir(`?periodo=${PERIODO}`)).cuerpo.data.tarjetas[0].detalle;
  assert.equal(abril.total_vendido, 139.14);
  const marzo = (await pedir("?periodo=2003-03")).cuerpo.data.tarjetas[0];
  assert.deepEqual([marzo.detalle.total_vendido, marzo.detalle.ventas_validas, marzo.valor], [999, 1, 999]);
  const mayo = (await pedir("?periodo=2003-05")).cuerpo.data.tarjetas[0];
  assert.deepEqual([mayo.detalle.total_vendido, mayo.detalle.ventas_validas], [999, 1]);
});

test("un mes sin ventas muestra Bs 0,00 (sin_ventas) y no rompe", async () => {
  const t = (await pedir("?periodo=2003-06")).cuerpo.data.tarjetas[0];
  assert.deepEqual([t.valor, t.detalle.ventas_validas, t.detalle.total_vendido, t.detalle.sin_ventas, t.color], [0, 0, 0, true, "ROJO"]);
});

test("sin periodo usa el mes actual; un periodo invalido da 400", async () => {
  const { status, cuerpo } = await pedir();
  assert.equal(status, 200);
  assert.match(cuerpo.data.periodo, /^\d{4}-\d{2}$/);
  for (const malo of ["2003-13", "abril", "2003-4", "2003-04-01"]) assert.equal((await pedir(`?periodo=${malo}`)).status, 400, malo);
});

test("solo el administrador: sin token 401, token invalido 401, cajero 403, Caja caida 503", async () => {
  assert.equal((await pedir("", null)).status, 401);
  assert.equal((await pedir("", "malo")).status, 401);
  const r = await pedir("", "CAJERO");
  assert.equal(r.status, 403);
  assert.match(r.cuerpo.mensaje, /permisos de Administrador/);
  const antes = process.env.ADMIN_VERIFICAR_URL;
  process.env.ADMIN_VERIFICAR_URL = "http://localhost:1";
  try {
    assert.equal((await pedir()).status, 503);
  } finally {
    process.env.ADMIN_VERIFICAR_URL = antes;
  }
});
