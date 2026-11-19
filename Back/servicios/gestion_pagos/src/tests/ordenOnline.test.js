// TDSI-114: GET /api/pagos/online/orden/:ordenId (lo usa Devoluciones). Base real; las ordenes se insertan DIRECTO
// (nunca por Pub/Sub ni facturando de verdad) y se borran al terminar.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/ventaOnlineRoutes");
const { obtenerOrden } = require("../services/ventaOnlineService");

const SUF = String(Date.now()).slice(-8);
const CON_FACTURA = `ORD-T114A-${SUF}`;
const SIN_FACTURA = `ORD-T114B-${SUF}`;
const ANULADA = `ORD-T114C-${SUF}`;
let servidor, base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/pagos", rutas);
  app.use(errorHandler);
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://localhost:${servidor.address().port}/api/pagos/online/orden`;

  const crear = async (orden, { factura = null, estado = "Pagado", metodo = "QR" } = {}) => {
    const { rows } = await query(
      `INSERT INTO pagos.ventas_online (orden_id, total, metodo_pago, estado, codigo_confirmacion, numero_factura) VALUES ($1, 150, $2, $3, 'CONF-T', $4) RETURNING id`,
      [orden, metodo, estado, factura]
    );
    await query(`INSERT INTO pagos.venta_online_items (venta_id, sku, descripcion, cantidad, precio_unitario, subtotal) VALUES ($1, 'SKU-1', 'Mouse', 3, 50, 150)`, [rows[0].id]);
  };
  await crear(CON_FACTURA, { factura: "F-000099" });
  await crear(SIN_FACTURA);
  await crear(ANULADA, { factura: "F-000098", estado: "Anulado" });
});
test.after(async () => {
  servidor.close();
  await query(`DELETE FROM pagos.ventas_online WHERE orden_id LIKE $1`, [`ORD-T114_-${SUF}`]);
  await pool.end();
});

test("una orden con factura emitida: estado, total, metodo, N° de factura y sus items", async () => {
  const r = await fetch(`${base}/${CON_FACTURA}`);
  assert.equal(r.status, 200);
  const { data } = await r.json();
  assert.deepEqual([data.orden_id, data.estado, data.total, data.metodo_pago, data.numero_factura, data.factura_emitida], [CON_FACTURA, "Pagado", 150, "QR", "F-000099", true]);
  assert.deepEqual(data.items.map((i) => [i.sku, i.descripcion, i.cantidad, i.subtotal]), [["SKU-1", "Mouse", 3, 150]]);
});

test("una orden sin factura emitida se informa con factura_emitida = false (Devoluciones decide que hacer)", async () => {
  const { data } = await (await fetch(`${base}/${SIN_FACTURA}`)).json();
  assert.deepEqual([data.numero_factura, data.factura_emitida], [null, false]);
});

test("una orden anulada se informa tal cual; una inexistente da 404", async () => {
  assert.equal((await (await fetch(`${base}/${ANULADA}`)).json()).data.estado, "Anulado");
  const r = await fetch(`${base}/ORD-NO-EXISTE-${SUF}`);
  assert.equal(r.status, 404);
  assert.match((await r.json()).mensaje, /No existe la orden/);
});

test("un numero de orden vacio o demasiado largo da 400", async () => {
  await assert.rejects(obtenerOrden("  "), (e) => e.status === 400);
  await assert.rejects(obtenerOrden("X".repeat(61)), (e) => e.status === 400);
});
