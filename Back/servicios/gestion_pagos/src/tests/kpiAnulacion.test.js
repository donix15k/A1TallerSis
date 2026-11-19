// TDSI-148: tasa de anulacion (facturas anuladas / facturas emitidas x 100) y su semaforo. Los calculos son puros; la consulta usa BD real
// en un mes lejano (febrero de 2005) con ventas insertadas DIRECTO y borradas al terminar.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query, pool } = require("../config/db");
const { tasaAnulacion, calcularPorcentaje, colorTasaAnulacion } = require("../services/kpiService");

const venta = (id, monto, fecha, estado = "Registrado") =>
  query(`INSERT INTO pagos.transacciones (id_transaccion, metodo, monto, tipo_pago, estado, fecha) VALUES ($1, 'Efectivo', $2, 'Simple', $3, $4::timestamptz)`, [id, monto, estado, fecha]);

test.after(async () => {
  await query(`DELETE FROM pagos.transacciones WHERE id_transaccion LIKE 'KPI148-%'`);
  await pool.end();
});

test("porcentaje: parte / total x 100 a 2 decimales; el ejemplo del enunciado, 31 de 1.073 = 2,89 %", () => {
  assert.equal(calcularPorcentaje(31, 1073), 2.89);
  assert.equal(calcularPorcentaje(1, 3), 33.33);
  assert.equal(calcularPorcentaje(0, 10), 0);
  assert.equal(calcularPorcentaje(10, 10), 100);
});

test("porcentaje sin total: 0 % (nunca NaN ni Infinity)", () => {
  for (const total of [0, "0", -5, null, undefined, NaN]) assert.equal(calcularPorcentaje(3, total), 0);
});

test("semaforo: VERDE hasta 2 %, AMARILLO por encima de 2 % y hasta 5 %, ROJO por encima de 5 %", () => {
  const casos = [[0, "VERDE"], [1.99, "VERDE"], [2, "VERDE"], [2.01, "AMARILLO"], [2.89, "AMARILLO"], [5, "AMARILLO"], [5.01, "ROJO"], [30, "ROJO"]];
  for (const [tasa, color] of casos) assert.equal(colorTasaAnulacion(tasa), color, String(tasa));
});

test("el mes con ventas y anuladas: tasa = anuladas / (validas + anuladas), con su color", async () => {
  // febrero de 2005: 38 validas + 2 anuladas = 40 emitidas -> 5,00 % (AMARILLO, justo el limite)
  for (let i = 0; i < 38; i++) await venta(`KPI148-V${i}`, 10, "2005-02-10 10:00:00-04");
  await venta("KPI148-A1", 10, "2005-02-11 10:00:00-04", "Anulado");
  await venta("KPI148-A2", 10, "2005-02-12 10:00:00-04", "Anulado");
  const t = await tasaAnulacion({ periodo: "2005-02" });
  assert.deepEqual([t.anuladas, t.emitidas, t.valor, t.color, t.sin_facturas], [2, 40, 5, "AMARILLO", false]);
  assert.deepEqual(t.umbrales, { verde: 2, amarillo: 5 });
});

test("una anulacion mas cruza al ROJO (3 de 41 = 7,32 %)", async () => {
  await venta("KPI148-A3", 10, "2005-02-13 10:00:00-04", "Anulado");
  const t = await tasaAnulacion({ periodo: "2005-02" });
  assert.deepEqual([t.anuladas, t.emitidas, t.valor, t.color], [3, 41, 7.32, "ROJO"]);
});

test("el pago mixto anulado cuenta UNA vez (no una por metodo)", async () => {
  await query(`INSERT INTO pagos.transacciones (id_transaccion, metodo, monto, tipo_pago, estado, fecha) VALUES ('KPI148-M', 'Efectivo', 5, 'Mixto', 'Anulado', '2005-03-05 10:00:00-04'), ('KPI148-M', 'QR', 5, 'Mixto', 'Anulado', '2005-03-05 10:00:00-04')`);
  await venta("KPI148-M2", 10, "2005-03-06 10:00:00-04");
  const t = await tasaAnulacion({ periodo: "2005-03" });
  assert.deepEqual([t.anuladas, t.emitidas, t.valor], [1, 2, 50]);
});

test("el limite del mes es hora de Bolivia: una anulacion a las 23:30 del 28/02 es de febrero, no de marzo", async () => {
  await venta("KPI148-L", 10, "2005-02-28 23:30:00-04", "Anulado");
  assert.equal((await tasaAnulacion({ periodo: "2005-02" })).anuladas, 4); // A1, A2, A3 y esta
  assert.equal((await tasaAnulacion({ periodo: "2005-03" })).anuladas, 1); // solo la del mixto
});

test("un mes sin facturas: 0 % (sin_facturas), VERDE y sin error; periodo invalido 400", async () => {
  const t = await tasaAnulacion({ periodo: "2005-07" });
  assert.deepEqual([t.anuladas, t.emitidas, t.valor, t.color, t.sin_facturas], [0, 0, 0, "VERDE", true]);
  await assert.rejects(tasaAnulacion({ periodo: "2005-7" }), (e) => e.status === 400);
});
