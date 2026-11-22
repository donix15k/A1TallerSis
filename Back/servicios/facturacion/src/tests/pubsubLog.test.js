// Registro unico de Pub/Sub (pagos.pubsub_verificaciones): lo que A1 envia y lo que recibe, con servicio, tipo, referencia, origen, destino y hora.
process.env.PUBSUB_LOG_EN_PRUEBAS = "1";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registrarEnvio, registrarRecepcion, grupoDeTopico, grupoDeSistemaOrigen } = require("../utils/pubsubLog");
const { pool } = require("../config/db");

const REF = `TEST-LOG-${Date.now()}`;

test.after(async () => {
  await pool.query("DELETE FROM pagos.pubsub_verificaciones WHERE referencia LIKE $1", [`${REF}%`]);
  await pool.end();
});

test("el grupo se deduce del topico y del sistema_origen", () => {
  assert.equal(grupoDeTopico("projects/p/topics/ucb-sis323-sub-d"), "D");
  assert.equal(grupoDeTopico("projects/p/topics/ucb-sis323-sub-a1"), "A1");
  assert.equal(grupoDeTopico(""), "OTRO");
  assert.equal(grupoDeSistemaOrigen("CONTABILIDAD"), "D");
  assert.equal(grupoDeSistemaOrigen("MARKETPLACE_Y_VENTAS"), "E");
  assert.equal(grupoDeSistemaOrigen("GESTION_DE_COMPRAS_Y_PROVEEDORES"), "C");
  assert.equal(grupoDeSistemaOrigen("GESTION_DE_PAGOS_Y_FACTURACION"), "A1");
  assert.equal(grupoDeSistemaOrigen("otro"), "OTRO");
});

test("un envio y una recepcion quedan con direccion, servicio, tipo, referencia, origen, destino, topico, messageId y fecha", async () => {
  await registrarEnvio({ servicio: "facturacion", tipo: "FACTURA_VENTA", referencia: `${REF}-E`, topico: "projects/p/topics/ucb-sis323-sub-d", payload: { a: 1 }, ok: true, messageId: "m-1" });
  await registrarEnvio({ servicio: "facturacion", tipo: "FACTURA_VENTA", referencia: `${REF}-F`, topico: "projects/p/topics/ucb-sis323-sub-d", ok: false, error: "PERMISSION_DENIED" });
  await registrarRecepcion({ servicio: "facturacion", tipo: "RESULTADO_DOCUMENTO", referencia: `${REF}-R`, origen: "D", payload: { estado: "aceptado" }, messageId: "m-2" });
  const { rows } = await pool.query(
    "SELECT direccion, servicio, tipo, referencia, grupo_origen, grupo, topico, ok, message_id, error, payload_enviado, creado_en FROM pagos.pubsub_verificaciones WHERE referencia LIKE $1 ORDER BY referencia",
    [`${REF}%`]
  );
  assert.equal(rows.length, 3);
  const [enviado, fallido, recibido] = rows;
  assert.deepEqual([enviado.direccion, enviado.servicio, enviado.tipo, enviado.grupo_origen, enviado.grupo, enviado.ok, enviado.message_id], ["ENVIADO", "facturacion", "FACTURA_VENTA", "A1", "D", true, "m-1"]);
  assert.deepEqual(enviado.payload_enviado, { a: 1 });
  assert.deepEqual([fallido.ok, fallido.error, fallido.message_id], [false, "PERMISSION_DENIED", null]);
  assert.deepEqual([recibido.direccion, recibido.grupo_origen, recibido.grupo, recibido.ok, recibido.message_id], ["RECIBIDO", "D", "A1", true, "m-2"]);
  assert.match(recibido.topico, /ucb-sis323-sub-a1$/);
  assert.ok(recibido.creado_en);
});

test("si el registro falla (por ejemplo una columna invalida) nunca revienta la operacion de negocio", async () => {
  await assert.doesNotReject(registrarEnvio({ servicio: "x".repeat(500), tipo: "T", referencia: `${REF}-X`, topico: "t" }));
});
