// TDSI-108/121: GET /api/devoluciones/:codigo/avisos -> estado del aviso a Compras (y al Marketplace) para el detalle.
// Pub/Sub FALSO; BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const cfg = require("../config/compras");
const { iniciarEntorno } = require("./helpers/entorno");

const TOPICO = "projects/project-test-12345/topics/ucb-sis323-sub-c";
const CAJERO = "cajero.avisos@tallersis.test";
let entorno;
let motivoId;
let topicoOriginal;

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  topicoOriginal = cfg.PUBSUB_TOPIC;
  cfg.PUBSUB_TOPIC = TOPICO;
});
test.after(async () => {
  cfg.PUBSUB_TOPIC = topicoOriginal;
  await entorno.cerrar();
});

async function registrar(n) {
  const numero = entorno.agregarFactura(700 + n, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", {
    factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1, estado_producto: "DEFECTUOSO" }], motivo_id: motivoId, cajero: CAJERO,
  });
  return cuerpo.data.codigo;
}

test("sin reembolsar todavia no hay aviso a Compras ni al Marketplace", async () => {
  const codigo = await registrar(1);
  const { status, cuerpo } = await entorno.get(`/api/devoluciones/${codigo}/avisos`);
  assert.equal(status, 200);
  assert.deepEqual(cuerpo.data, { codigo, compras: null, marketplace: null });
});

test("al reembolsar se ve el aviso a Compras con su estado visible y su messageId", async () => {
  const codigo = await registrar(2);
  await entorno.post(`/api/devoluciones/${codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  await entorno.post(`/api/devoluciones/${codigo}/reembolsar`, { cajero: CAJERO });
  const { status, cuerpo } = await entorno.get(`/api/devoluciones/${codigo}/avisos`);
  assert.equal(status, 200);
  assert.equal(cuerpo.data.compras.estado, "Enviado");
  assert.ok(cuerpo.data.compras.pubsub_message_id);
  assert.equal(cuerpo.data.compras.numero_reclamo, null);
  assert.equal(cuerpo.data.marketplace, null); // es una devolucion de la tienda
});

test("codigo invalido -> 400; inexistente -> 404", async () => {
  assert.equal((await entorno.get("/api/devoluciones/XYZ/avisos")).status, 400);
  assert.equal((await entorno.get("/api/devoluciones/DEV-999999/avisos")).status, 404);
});
