// TDSI-140: pruebas de kpiService con BD real: periodo sin ventas, ventas anuladas, pagos mixtos y limites del mes en hora de Bolivia.
// Las ventas de prueba se insertan DIRECTO en un mes lejano (septiembre de 2004) y se borran al terminar.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query, pool } = require("../config/db");
const { ticketPromedio, resumen, ventasEntre } = require("../services/kpiService");

const venta = (id, metodo, monto, fecha, estado = "Registrado", tipo = "Simple") =>
  query(`INSERT INTO pagos.transacciones (id_transaccion, metodo, monto, tipo_pago, estado, fecha) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`, [id, metodo, monto, tipo, estado, fecha]);

test.before(async () => {
  // septiembre de 2004: dos ventas validas (una de ellas mixta) y dos anuladas
  await venta("KPI140-A", "Efectivo", 60, "2004-09-05 10:00:00-04");
  await venta("KPI140-B", "Efectivo", 10, "2004-09-20 11:00:00-04", "Registrado", "Mixto");
  await venta("KPI140-B", "Tarjeta", 20, "2004-09-20 11:00:00-04", "Registrado", "Mixto");
  await venta("KPI140-X1", "QR", 500, "2004-09-12 09:00:00-04", "Anulado");
  await venta("KPI140-X2", "Efectivo", 100, "2004-09-13 09:00:00-04", "Anulado");
  // octubre de 2004: SOLO ventas anuladas
  await venta("KPI140-X3", "Efectivo", 250, "2004-10-02 09:00:00-04", "Anulado");
  // noviembre de 2004: una sola venta de Bs 44,99 (justo bajo el umbral de AMARILLO/VERDE) en el ultimo instante del mes (Bolivia)
  await venta("KPI140-N", "QR", 44.99, "2004-11-30 23:59:30-04");
});
test.after(async () => {
  await query(`DELETE FROM pagos.transacciones WHERE id_transaccion LIKE 'KPI140-%'`);
  await pool.end();
});

test("periodo SIN ventas: Bs 0,00, 0 ventas, sin_ventas y sin error (no NaN ni division por cero)", async () => {
  const t = await ticketPromedio({ periodo: "2004-07" });
  assert.deepEqual([t.valor, t.total_vendido, t.ventas_validas, t.ventas_anuladas, t.sin_ventas], [0, 0, 0, 0, true]);
  assert.equal(t.color, "ROJO");
  assert.ok(Number.isFinite(t.valor));
});

test("las ventas ANULADAS no cuentan: ni en el total ni en la cantidad (se informan aparte)", async () => {
  const t = await ticketPromedio({ periodo: "2004-09" });
  assert.equal(t.total_vendido, 90); // 60 + (10 + 20), sin los 500 y 100 anulados
  assert.equal(t.ventas_validas, 2);
  assert.equal(t.ventas_anuladas, 2);
  assert.equal(t.valor, 45); // 90 / 2
  assert.equal(t.color, "VERDE"); // 45 justo es VERDE
});

test("un periodo con SOLO ventas anuladas se comporta como un periodo sin ventas", async () => {
  const t = await ticketPromedio({ periodo: "2004-10" });
  assert.deepEqual([t.valor, t.total_vendido, t.ventas_validas, t.ventas_anuladas, t.sin_ventas], [0, 0, 0, 1, true]);
});

test("un pago mixto es UNA venta (dos filas, mismo id_transaccion) y suma todos sus metodos", async () => {
  const v = await ventasEntre("2004-09-20", "2004-09-20");
  assert.deepEqual([v.total_vendido, v.ventas_validas], [30, 1]);
});

test("los limites del mes son hora de Bolivia: 23:59:30 del 30/11 es noviembre; y Bs 44,99 es AMARILLO", async () => {
  const nov = await ticketPromedio({ periodo: "2004-11" });
  assert.deepEqual([nov.valor, nov.ventas_validas, nov.color], [44.99, 1, "AMARILLO"]);
  assert.equal((await ticketPromedio({ periodo: "2004-12" })).ventas_validas, 0); // 03:59:30Z del 1/12 sigue siendo noviembre en Bolivia
});

test("el resumen trae la tarjeta Ticket promedio con los mismos numeros", async () => {
  const r = await resumen({ periodo: "2004-09" });
  assert.deepEqual([r.periodo, r.desde, r.hasta], ["2004-09", "2004-09-01", "2004-09-30"]);
  const [t] = r.tarjetas;
  assert.deepEqual([t.id, t.valor, t.color, t.detalle.ventas_validas, t.detalle.ventas_anuladas, t.detalle.total_vendido], ["ticket_promedio", 45, "VERDE", 2, 2, 90]);
});

test("un periodo invalido lanza 400 antes de consultar la base", async () => {
  await assert.rejects(ticketPromedio({ periodo: "2004-9" }), (e) => e.status === 400);
  await assert.rejects(resumen({ periodo: "septiembre" }), (e) => e.status === 400);
});
