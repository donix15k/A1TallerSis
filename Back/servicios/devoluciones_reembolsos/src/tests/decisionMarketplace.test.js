// Decision del supervisor sobre productos del Marketplace: ni bien APRUEBA o RECHAZA se publica UN mensaje en el topico del Marketplace (grupo E) con la
// orden, los productos, el supervisor (usuario y nombre), el motivo y la fecha y hora. Pub/Sub FALSO (nunca se publica de verdad); BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const decision = require("../services/decisionMarketplaceService");
const { iniciarEntorno } = require("./helpers/entorno");

const TOPICO = "projects/project-test-12345/topics/ucb-sis323-sub-e";
const CAJERO = "cajero.decision@tallersis.test";
let entorno;
let motivoId;
let contador = 0;

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  decision.usarTopicoDePrueba(TOPICO);
});
test.beforeEach(() => {
  entorno.pubsub.publicados.length = 0;
});
test.after(async () => {
  decision.usarTopicoDePrueba(undefined);
  await entorno.cerrar();
});

const items = [{ descripcion: "Producto A", cantidad: 2, estado_producto: "BUEN_ESTADO" }];
const alMarketplace = () => entorno.pubsub.publicados.filter((p) => p.topico === TOPICO);

async function registrar(canal) {
  const numero = entorno.agregarFactura(40 + ++contador, { canal });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items, motivo_id: motivoId, cajero: CAJERO, observaciones: "El cliente pidio cambio" });
  return cuerpo.data.codigo;
}

test("al APROBAR productos de un pedido online se publica la decision al Marketplace con supervisor, productos, motivo y fecha y hora", async () => {
  const codigo = await registrar("Online");
  const r = await entorno.post(`/api/devoluciones/${codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.data.aviso_marketplace.publicado, true);

  assert.equal(alMarketplace().length, 1);
  const { json, attributes } = alMarketplace()[0];
  // mismo sobre que los demas mensajes del grupo
  assert.deepEqual(Object.keys(json), ["sistema_origen", "referencia_externa", "tipo_operacion", "fecha_documento", "datos"]);
  assert.equal(json.sistema_origen, "GESTION_DE_PAGOS_Y_FACTURACION");
  assert.equal(json.referencia_externa, codigo);
  assert.equal(json.tipo_operacion, "decision_devolucion");
  assert.equal(json.datos.resultado, "aprobada");
  assert.equal(json.datos.origen, "TIENDA");
  assert.equal(json.datos.productos[0].descripcion, "Producto A");
  assert.equal(json.datos.productos[0].cantidad, 2);
  assert.equal(json.datos.supervisor.usuario, "SUP-OK"); // usuario del supervisor (y su nombre si esta en la tabla de supervisores)
  assert.match(json.datos.decidida_en, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(json.datos.hora, /^\d{2}:\d{2}$/);
  assert.equal(json.datos.cajero.usuario, CAJERO);
  assert.equal(json.datos.motivo_decision, "El cliente pidio cambio");
  assert.equal(attributes.idempotency_key, `${codigo}-APROBADA`);
  assert.equal(attributes.tipo, "DECISION_DEVOLUCION");

  const { rows } = await query(`SELECT e.estado, e.pubsub_message_id FROM devoluciones.envios_marketplace_decision e JOIN devoluciones.devoluciones d ON d.id = e.devolucion_id WHERE d.codigo = $1`, [codigo]);
  assert.deepEqual(rows.map((x) => x.estado), ["Enviado"]);
});

test("al RECHAZAR se publica la decision con el motivo que escribio el supervisor", async () => {
  const codigo = await registrar("Online");
  const r = await entorno.post(`/api/devoluciones/${codigo}/rechazar`, { supervisor_id: "SUP-OK", pin: "1234", motivo_rechazo: "El producto muestra uso y no es un defecto" });
  assert.equal(r.status, 200);
  assert.equal(alMarketplace().length, 1);
  const { json } = alMarketplace()[0];
  assert.equal(json.datos.resultado, "rechazada");
  assert.equal(json.datos.motivo_decision, "El producto muestra uso y no es un defecto");
  assert.equal(json.datos.supervisor.usuario, "SUP-OK");
  assert.equal(alMarketplace()[0].attributes.idempotency_key, `${codigo}-RECHAZADA`);
});

test("si los productos no son del Marketplace (factura de mostrador) no se avisa nada", async () => {
  const codigo = await registrar("Presencial");
  const r = await entorno.post(`/api/devoluciones/${codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  assert.equal(r.status, 200);
  assert.equal(alMarketplace().length, 0);
  assert.equal(r.cuerpo.data.aviso_marketplace.publicado, false);
});

test("una decision se avisa una sola vez, y si Pub/Sub falla la aprobacion igual queda hecha", async () => {
  const codigo = await registrar("Online");
  entorno.pubsub.falla = Object.assign(new Error("sin red"), { code: 14 });
  const r = await entorno.post(`/api/devoluciones/${codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.data.estado, "APROBADA");
  assert.equal(r.cuerpo.data.aviso_marketplace.publicado, false);
  const { rows } = await query(`SELECT e.estado, e.error FROM devoluciones.envios_marketplace_decision e JOIN devoluciones.devoluciones d ON d.id = e.devolucion_id WHERE d.codigo = $1`, [codigo]);
  assert.equal(rows[0].estado, "Error");

  entorno.pubsub.falla = null; // al reintentar se publica; y una vez enviado no se repite
  assert.equal((await decision.avisarDecision(codigo)).publicado, true);
  assert.equal((await decision.avisarDecision(codigo)).yaEnviado, true);
  assert.equal(alMarketplace().length, 1);
});
