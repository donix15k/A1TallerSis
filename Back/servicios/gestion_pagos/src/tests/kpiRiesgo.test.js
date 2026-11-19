// TDSI-150: GET /api/kpis/riesgo (tasa de anulacion + tasa de devoluciones con su semaforo). BD real en un mes lejano (mayo de 2002),
// ventas insertadas DIRECTO y borradas al terminar; Caja (administrador) y Devoluciones son servidores HTTP locales.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/kpiRoutes");
const { colorTasaDevoluciones, UMBRALES_DEVOLUCIONES } = require("../services/kpiService");

let caja, devs, servidor, base;
let devolucion; // lo que responde Devoluciones: objeto, o "caida"
let tokenRecibido;

const venta = (id, monto, fecha, estado = "Registrado") =>
  query(`INSERT INTO pagos.transacciones (id_transaccion, metodo, monto, tipo_pago, estado, fecha) VALUES ($1, 'Efectivo', $2, 'Simple', $3, $4::timestamptz)`, [id, monto, estado, fecha]);

test.before(async () => {
  caja = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if ((req.headers.authorization || "") === "Bearer ADMIN") return res.end(JSON.stringify({ ok: true, data: { administrador_id: "A" } }));
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, mensaje: "no" }));
  });
  await new Promise((r) => caja.listen(0, r));
  process.env.ADMIN_VERIFICAR_URL = `http://localhost:${caja.address().port}`;
  devs = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    tokenRecibido = req.headers.authorization;
    if (devolucion === "caida") { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, mensaje: "boom" })); }
    res.end(JSON.stringify({ ok: true, data: devolucion }));
  });
  await new Promise((r) => devs.listen(0, r));
  process.env.DEVOLUCIONES_URL = `http://localhost:${devs.address().port}`;

  // mayo de 2002: 38 validas de Bs 100 = 3800, y 2 anuladas -> 2 de 40 = 5 % (AMARILLO)
  for (let i = 0; i < 38; i++) await venta(`KPI150-V${i}`, 100, "2002-05-10 10:00:00-04");
  await venta("KPI150-A1", 100, "2002-05-11 10:00:00-04", "Anulado");
  await venta("KPI150-A2", 100, "2002-05-12 10:00:00-04", "Anulado");

  const app = express();
  app.use(express.json());
  app.use("/api/kpis", rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis`;
});
test.beforeEach(() => {
  devolucion = { periodo: "2002-05", monto_devuelto: 95, cantidad: 2, motivos: [{ motivo: "Producto defectuoso", cantidad: 1, monto: 60, porcentaje: 63.16 }, { motivo: "Otro", cantidad: 1, monto: 35, porcentaje: 36.84 }] };
});
test.after(async () => {
  await query(`DELETE FROM pagos.transacciones WHERE id_transaccion LIKE 'KPI150-%'`);
  delete process.env.ADMIN_VERIFICAR_URL;
  delete process.env.DEVOLUCIONES_URL;
  servidor.close();
  caja.close();
  devs.close();
  await pool.end();
});

const pedir = (ruta, qs, token = "ADMIN") => fetch(`${base}/${ruta}${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

test("semaforo de devoluciones: VERDE hasta 1,5 %, AMARILLO hasta 3 %, ROJO por encima", () => {
  const casos = [[0, "VERDE"], [1.5, "VERDE"], [1.51, "AMARILLO"], [3, "AMARILLO"], [3.01, "ROJO"], [10, "ROJO"]];
  for (const [t, c] of casos) assert.equal(colorTasaDevoluciones(t), c, String(t));
  assert.deepEqual(UMBRALES_DEVOLUCIONES, { verde: 1.5, amarillo: 3 });
});

test("riesgo: anulacion (2 de 40 = 5 %) y devoluciones (95 / 3800 = 2,5 %) con su color y los motivos", async () => {
  const { status, cuerpo } = await pedir("riesgo", "?periodo=2002-05");
  assert.equal(status, 200);
  const d = cuerpo.data;
  assert.deepEqual([d.periodo, d.desde, d.hasta], ["2002-05", "2002-05-01", "2002-05-31"]);
  assert.deepEqual([d.anulacion.valor, d.anulacion.color, d.anulacion.anuladas, d.anulacion.emitidas], [5, "AMARILLO", 2, 40]);
  assert.deepEqual([d.devoluciones.valor, d.devoluciones.color, d.devoluciones.monto_devuelto, d.devoluciones.monto_vendido, d.devoluciones.disponible], [2.5, "AMARILLO", 95, 3800, true]);
  assert.deepEqual(d.devoluciones.motivos.map((m) => m.motivo), ["Producto defectuoso", "Otro"]);
  assert.equal(tokenRecibido, "Bearer ADMIN"); // reenvia el token del administrador
});

test("el color de devoluciones cambia con el monto devuelto (38 -> VERDE 1 %; 190 -> ROJO 5 %)", async () => {
  devolucion = { ...devolucion, monto_devuelto: 38 };
  let d = (await pedir("riesgo", "?periodo=2002-05")).cuerpo.data.devoluciones;
  assert.deepEqual([d.valor, d.color], [1, "VERDE"]);
  devolucion = { ...devolucion, monto_devuelto: 190 };
  d = (await pedir("riesgo", "?periodo=2002-05")).cuerpo.data.devoluciones;
  assert.deepEqual([d.valor, d.color], [5, "ROJO"]);
});

test("sin ventas en el mes ambas tasas son 0 % (nunca NaN)", async () => {
  devolucion = { monto_devuelto: 0, cantidad: 0, motivos: [] };
  const d = (await pedir("riesgo", "?periodo=2002-08")).cuerpo.data;
  assert.deepEqual([d.anulacion.valor, d.anulacion.color, d.devoluciones.valor, d.devoluciones.color, d.devoluciones.motivos], [0, "VERDE", 0, "VERDE", []]);
});

test("Devoluciones caido: la anulacion se calcula igual y devoluciones queda en null con su error (no se cae el Panel)", async () => {
  devolucion = "caida";
  const r = await pedir("riesgo", "?periodo=2002-05");
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.data.anulacion.valor, 5);
  assert.deepEqual([r.cuerpo.data.devoluciones.valor, r.cuerpo.data.devoluciones.color, r.cuerpo.data.devoluciones.disponible], [null, null, false]);
  assert.match(r.cuerpo.data.devoluciones.error, /boom/);
  const puerto = devs.address().port;
  process.env.DEVOLUCIONES_URL = "http://localhost:1";
  try {
    assert.match((await pedir("riesgo", "?periodo=2002-05")).cuerpo.data.devoluciones.error, /No se pudo conectar/);
  } finally {
    process.env.DEVOLUCIONES_URL = `http://localhost:${puerto}`;
  }
});

test("el resumen incluye las tarjetas Anulacion y Devoluciones", async () => {
  const t = (await pedir("resumen", "?periodo=2002-05")).cuerpo.data.tarjetas;
  assert.deepEqual(t.map((x) => [x.id, x.valor, x.color]), [["ticket_promedio", 100, "VERDE"], ["anulacion", 5, "AMARILLO"], ["devoluciones", 2.5, "AMARILLO"]]);
});

test("solo el administrador (401 sin token) y periodo invalido 400", async () => {
  assert.equal((await pedir("riesgo", "?periodo=2002-05", null)).status, 401);
  assert.equal((await pedir("riesgo", "?periodo=2002-13")).status, 400);
  assert.match((await pedir("riesgo", "")).cuerpo.data.periodo, /^\d{4}-\d{2}$/);
});
