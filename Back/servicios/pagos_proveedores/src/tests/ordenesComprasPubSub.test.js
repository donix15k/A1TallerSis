// Ordenes de pago de Compras por Pub/Sub: el job lee la suscripcion de A1 (cliente FALSO, nunca se toca Pub/Sub real), guarda solo las ordenes,
// libera lo que no es suyo y deja cada orden recibida en el registro unico (pagos.pubsub_verificaciones). Base de datos real; se limpia al final.
process.env.PUBSUB_LOG_EN_PRUEBAS = "1";
process.env.ORDENES_COMPRAS_SUBSCRIPTION = "projects/proyecto-prueba/subscriptions/sub-prueba";

const test = require("node:test");
const assert = require("node:assert/strict");
const subscriber = require("../clients/pubsubSubscriber");
const { interpretar } = require("../services/ordenesComprasPubSubService");
const { procesarOrdenes } = require("../jobs/ordenesCompras");
const { pool } = require("../config/db");

const SUFIJO = `T${Date.now()}`;
const orden = (n, extra = {}) => ({
  sistema_origen: "GESTION_DE_COMPRAS_Y_PROVEEDORES",
  tipo_operacion: "orden_pago",
  referencia_externa: `OP-${SUFIJO}-${n}`,
  fecha_documento: "2026-11-22",
  datos: {
    numero: `OP-${SUFIJO}-${n}`,
    ordenCompraId: `OC-${SUFIJO}-${n}`,
    monto: 1500.5,
    proveedor: { nit: "1234567015", razonSocial: "Proveedor de Prueba S.A.", cuentaBancaria: "10000029384", banco: "Banco Union" },
    fechaVencimiento: "2026-12-30",
    concepto: "Prueba de Pub/Sub",
    ...extra,
  },
});

let confirmados, liberados, mensajes;
const clienteFalso = () => ({
  pull: async () => [{ receivedMessages: mensajes.map((m, i) => ({ ackId: `ack-${i}`, message: { messageId: `msg-${SUFIJO}-${i}`, data: Buffer.from(typeof m === "string" ? m : JSON.stringify(m)), attributes: {} } })) }],
  acknowledge: async ({ ackIds }) => { confirmados.push(...ackIds); },
  modifyAckDeadline: async ({ ackIds }) => { liberados.push(...ackIds); },
});

test.beforeEach(() => {
  confirmados = [];
  liberados = [];
  subscriber.usarClienteDePrueba(clienteFalso());
});
test.after(async () => {
  subscriber.usarClienteDePrueba(null);
  await pool.query("DELETE FROM proveedores.notificaciones_admin WHERE orden_pago_id IN (SELECT id FROM proveedores.ordenes_pago WHERE numero LIKE $1)", [`OP-${SUFIJO}-%`]);
  await pool.query("DELETE FROM proveedores.ordenes_pago WHERE numero LIKE $1", [`OP-${SUFIJO}-%`]);
  await pool.query("DELETE FROM pagos.pubsub_verificaciones WHERE referencia LIKE $1", [`OP-${SUFIJO}-%`]);
  await pool.end();
});

test("interpretar: solo es suya una orden_pago que manda Compras; el resto (respuestas de Contabilidad, ventas, texto suelto) no", () => {
  assert.ok(interpretar(JSON.stringify(orden(0))));
  assert.equal(interpretar(JSON.stringify({ sistema_origen: "CONTABILIDAD", tipo_mensaje: "resultado_documento", referencia_externa: "F-000001", estado: "aceptado" })), null);
  assert.equal(interpretar(JSON.stringify({ ordenId: "MKT-1", sistema_origen: "MARKETPLACE_Y_VENTAS" })), null);
  assert.equal(interpretar(JSON.stringify({ ...orden(0), sistema_origen: "MARKETPLACE_Y_VENTAS" })), null);
  assert.equal(interpretar("hola"), null);
  assert.equal(interpretar("[1,2]"), null);
});

test("el job guarda la orden PENDIENTE, confirma solo lo suyo, libera lo ajeno y deja cada orden en el registro de Pub/Sub", async () => {
  mensajes = [
    orden(1), // valida
    orden(2, { monto: -5 }), // propia pero invalida: se confirma (nunca va a poder procesarse) y queda con su error
    { sistema_origen: "CONTABILIDAD", tipo_mensaje: "resultado_documento", referencia_externa: "F-000001", estado: "aceptado" }, // ajeno
    "texto que no es JSON", // ajeno
  ];
  const r = await procesarOrdenes();
  assert.equal(r.length, 2);
  assert.deepEqual(confirmados, ["ack-0", "ack-1"]);
  assert.deepEqual(liberados, ["ack-2", "ack-3"]);

  const guardada = await pool.query("SELECT estado, monto FROM proveedores.ordenes_pago WHERE numero = $1", [`OP-${SUFIJO}-1`]);
  assert.equal(guardada.rows[0].estado, "PENDIENTE");
  assert.equal(Number(guardada.rows[0].monto), 1500.5);
  assert.equal((await pool.query("SELECT 1 FROM proveedores.ordenes_pago WHERE numero = $1", [`OP-${SUFIJO}-2`])).rowCount, 0);

  const log = await pool.query(
    "SELECT direccion, servicio, tipo, referencia, grupo_origen, grupo, topico, ok, message_id, error, creado_en FROM pagos.pubsub_verificaciones WHERE referencia LIKE $1 ORDER BY referencia",
    [`OP-${SUFIJO}-%`]
  );
  assert.equal(log.rowCount, 2);
  const [buena, mala] = log.rows;
  assert.deepEqual([buena.direccion, buena.servicio, buena.tipo, buena.grupo_origen, buena.grupo, buena.ok], ["RECIBIDO", "pagos_proveedores", "ORDEN_PAGO", "C", "A1", true]);
  assert.match(buena.topico, /ucb-sis323-sub-a1$/);
  assert.equal(buena.message_id, `msg-${SUFIJO}-0`);
  assert.ok(buena.creado_en);
  assert.deepEqual([mala.ok, /monto/i.test(mala.error)], [false, true]);
});

test("una orden repetida no se guarda dos veces: se confirma y se informa como ya registrada", async () => {
  mensajes = [orden(3)];
  await procesarOrdenes();
  confirmados = [];
  const r = await procesarOrdenes();
  assert.equal(r[0].duplicada, true);
  assert.deepEqual(confirmados, ["ack-0"]);
  assert.equal((await pool.query("SELECT 1 FROM proveedores.ordenes_pago WHERE numero = $1", [`OP-${SUFIJO}-3`])).rowCount, 1);
});
