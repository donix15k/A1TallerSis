// Reporte de cierre de caja: devoluciones reembolsadas por un cajero dentro de su turno, con productos, monto y forma de devolucion
// (una reversion de QR cuenta como "Tarjeta"). BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const devolucionService = require("../services/devolucionService");

const CODIGO = `DEV-T${Date.now().toString().slice(-8)}`;
const CAJERO = `cajero-turno-${Date.now()}`;
let id;

test.before(async () => {
  const { rows } = await query(
    `INSERT INTO devoluciones.devoluciones (codigo, factura_numero, fecha_venta, dentro_de_plazo, tipo, metodo_pago_original, monto_total, estado)
     VALUES ($1, 'F-TEST', now(), true, 'PARCIAL', 'Efectivo', 52, 'PROCESADA') RETURNING id`,
    [CODIGO]
  );
  id = rows[0].id;
  await query(`INSERT INTO devoluciones.devolucion_items (devolucion_id, descripcion, cantidad, precio_unitario, subtotal) VALUES ($1,'Aceite Fino',1,15,15),($1,'Queso criollo',1,25,25),($1,'Leche PIL',1,12,12)`, [id]);
  await query(`INSERT INTO devoluciones.historial_estados (devolucion_id, estado_anterior, estado_nuevo, cambiado_por) VALUES ($1,'APROBADA','PROCESADA',$2)`, [id, CAJERO]);
  await query(`INSERT INTO devoluciones.reembolsos (devolucion_id, tipo, monto, estado) VALUES ($1,'EFECTIVO',12,'PROCESADO'),($1,'REVERSION_QR',40,'PROCESADO')`, [id]);
});
test.after(async () => {
  await query(`DELETE FROM devoluciones.devoluciones WHERE id = $1`, [id]); // los items, el historial y los reembolsos caen en cascada
});

const ahora = Date.now();
const ventana = { desde: new Date(ahora - 3600_000).toISOString(), hasta: new Date(ahora + 3600_000).toISOString() };

test("la devolucion del turno trae productos, monto y la forma: el QR cuenta como Tarjeta", async () => {
  const r = await devolucionService.listarReembolsadasDelTurno({ ...ventana, cajeros: CAJERO });
  assert.equal(r.length, 1);
  assert.equal(r[0].codigo, CODIGO);
  assert.equal(r[0].factura_numero, "F-TEST");
  assert.equal(r[0].monto_total, 52);
  assert.deepEqual(r[0].productos.map((p) => [p.descripcion, p.cantidad, p.subtotal]), [["Aceite Fino", 1, 15], ["Queso criollo", 1, 25], ["Leche PIL", 1, 12]]);
  assert.deepEqual(r[0].reembolsos, [{ forma: "Efectivo", monto: 12 }, { forma: "Tarjeta", monto: 40 }]);
  assert.deepEqual(r[0].por_metodo, [{ metodo: "Efectivo", monto: 12 }, { metodo: "QR", monto: 40 }]); // el cierre descuenta el QR aparte de la tarjeta
  assert.ok(r[0].procesada_en);
});

test("solo cuenta lo del cajero y de la ventana de tiempo del turno", async () => {
  assert.deepEqual(await devolucionService.listarReembolsadasDelTurno({ ...ventana, cajeros: "otro-cajero" }), []);
  const antes = { desde: new Date(ahora - 7200_000).toISOString(), hasta: new Date(ahora - 3600_000).toISOString() };
  assert.deepEqual(await devolucionService.listarReembolsadasDelTurno({ ...antes, cajeros: CAJERO }), []);
});

test("pide el cajero y fechas validas", async () => {
  await assert.rejects(devolucionService.listarReembolsadasDelTurno({ ...ventana }), { status: 400 });
  await assert.rejects(devolucionService.listarReembolsadasDelTurno({ desde: "x", cajeros: CAJERO }), { status: 400 });
});
