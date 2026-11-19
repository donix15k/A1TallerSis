// TDSI-95: POST /api/devoluciones/:codigo/contabilidad/reenviar (solo administrador). Pub/Sub FALSO; BD real.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const repo = require("../data/enviosContabilidadRepo");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.reenvia@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});
test.beforeEach(() => {
  entorno.pubsub.publicados.length = 0;
  entorno.pubsub.falla = null;
});
test.after(() => entorno.cerrar());

async function procesada({ fallaPubsub = null } = {}) {
  const numero = entorno.agregarFactura(40 + ++contador, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1 }], motivo_id: motivoId, cajero: CAJERO });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  entorno.pubsub.falla = fallaPubsub;
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/reembolsar`, { cajero: CAJERO });
  entorno.pubsub.falla = null;
  return cuerpo.data.codigo;
}
const reenviar = (codigo, token = entorno.TOKEN_ADMIN) =>
  fetch(`${entorno.base}/api/devoluciones/${codigo}/contabilidad/reenviar`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
const envioDe = (codigo) => repo.obtenerPorDevolucionCodigo(codigo);

test("un envio en Error vuelve a Enviado con un NUEVO messageId al reenviarlo", async () => {
  const codigo = await procesada({ fallaPubsub: Object.assign(new Error("PERMISSION_DENIED"), { code: 7 }) });
  const antes = await envioDe(codigo);
  assert.deepEqual([antes.estado, antes.pubsub_message_id], ["Error", null]);

  const r = await reenviar(codigo);
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.equal(cuerpo.mensaje, "Nota de crédito reenviada a Contabilidad");
  assert.deepEqual([cuerpo.data.estado, cuerpo.data.contabilidad.estado], ["Enviado", "Enviado"]);
  const e = await envioDe(codigo);
  assert.deepEqual([e.estado, e.intentos, e.ultimo_error], ["Enviado", 1, null]); // nuevo ciclo: 1 intento
  assert.match(e.pubsub_message_id, /^fake-msg-\d+$/);
  assert.equal(entorno.pubsub.publicados.length, 1);
  assert.equal(entorno.pubsub.publicados[0].attributes.referencia_externa, (await query(`SELECT n.numero FROM devoluciones.notas_credito n JOIN devoluciones.devoluciones d ON d.id = n.devolucion_id WHERE d.codigo = $1`, [codigo])).rows[0].numero);
  assert.equal(e.id, antes.id); // la misma fila: no se crea otro envio
});

test("si el reenvio vuelve a fallar, responde 200 con el estado en que quedo y no pierde la nota", async () => {
  const codigo = await procesada({ fallaPubsub: Object.assign(new Error("PERMISSION_DENIED"), { code: 7 }) });
  entorno.pubsub.falla = Object.assign(new Error("UNAVAILABLE"), { code: 14 });
  const r = await reenviar(codigo);
  assert.equal(r.status, 200);
  assert.match((await r.json()).mensaje, /El reenvío quedó Pendiente/);
  assert.deepEqual([(await envioDe(codigo)).estado, (await envioDe(codigo)).intentos], ["Pendiente", 1]);
});

test("solo se reenvian los envios en Error: uno Enviado o Pendiente da 409 y no se publica nada", async () => {
  const enviada = await procesada();
  assert.equal((await envioDe(enviada)).estado, "Enviado");
  const r1 = await reenviar(enviada);
  assert.equal(r1.status, 409);
  assert.match((await r1.json()).mensaje, /Solo se pueden reenviar los envíos con estado Error \(este está Enviado\)/);

  const pendiente = await procesada({ fallaPubsub: Object.assign(new Error("UNAVAILABLE"), { code: 14 }) });
  const antes = entorno.pubsub.publicados.length; // lo que ya publico el reembolso de "enviada"
  assert.equal((await reenviar(pendiente)).status, 409);
  assert.equal(entorno.pubsub.publicados.length, antes); // el reenvio rechazado no publica nada
});

test("devolucion sin envio (no procesada) o inexistente: 404", async () => {
  const numero = entorno.agregarFactura(40 + ++contador, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1 }], motivo_id: motivoId, cajero: CAJERO });
  const r = await reenviar(cuerpo.data.codigo);
  assert.equal(r.status, 404);
  assert.match((await r.json()).mensaje, /no tiene un envío a Contabilidad/);
  assert.equal((await reenviar("DEV-999999")).status, 404);
});

test("solo el administrador puede reenviar: sin token 401, cajero 403", async () => {
  const codigo = await procesada({ fallaPubsub: Object.assign(new Error("PERMISSION_DENIED"), { code: 7 }) });
  assert.equal((await reenviar(codigo, null)).status, 401);
  assert.equal((await reenviar(codigo, "CAJERO-TEST")).status, 403);
  assert.equal((await envioDe(codigo)).estado, "Error"); // sigue sin reenviarse
});
