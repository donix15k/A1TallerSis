// TDSI-129: POST /api/integraciones/mensajes/:id/reenviar de Devoluciones (id compuesto: contabilidad-N, compras-N, marketplace-N).
// Pub/Sub FALSO (nunca se publica de verdad); BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const cfgCompras = require("../config/compras");
const cfgMarketplace = require("../config/marketplace");
const { iniciarEntorno } = require("./helpers/entorno");

const TOPICO_C = "projects/project-test-12345/topics/ucb-sis323-sub-c";
const TOPICO_E = "projects/project-test-12345/topics/ucb-sis323-sub-e";
let entorno;
let motivoId;
let contador = 0;
let comprasOriginal;
let marketplaceOriginal;
const CAJERO = "cajero.reenvio@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  comprasOriginal = cfgCompras.PUBSUB_TOPIC;
  marketplaceOriginal = cfgMarketplace.PUBSUB_TOPIC;
  cfgCompras.PUBSUB_TOPIC = TOPICO_C;
  cfgMarketplace.PUBSUB_TOPIC = TOPICO_E;
});
test.beforeEach(() => { entorno.pubsub.publicados.length = 0; entorno.pubsub.falla = null; });
test.after(async () => { cfgCompras.PUBSUB_TOPIC = comprasOriginal; cfgMarketplace.PUBSUB_TOPIC = marketplaceOriginal; await entorno.cerrar(); });

/** Devolucion del Marketplace reembolsada con Pub/Sub sin permiso: sus TRES avisos quedan en Error. */
async function conTresErrores() {
  const numero = entorno.agregarFactura(110 + ++contador, { canal: "Online", metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1, estado_producto: "DEFECTUOSO" }], motivo_id: motivoId, cajero: "MARKETPLACE" });
  const codigo = cuerpo.data.codigo;
  await query(`UPDATE devoluciones.devoluciones SET origen = 'MARKETPLACE', orden_id = $2 WHERE codigo = $1`, [codigo, `ORD-${codigo}`]);
  await entorno.post(`/api/devoluciones/${codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  entorno.pubsub.falla = Object.assign(new Error("PERMISSION_DENIED"), { code: 7 });
  await entorno.post(`/api/devoluciones/${codigo}/reembolsar`, { cajero: CAJERO });
  entorno.pubsub.falla = null;
  entorno.pubsub.publicados.length = 0;
  return codigo;
}
const lista = async (codigo) => (await entorno.get("/api/integraciones/mensajes")).cuerpo.data.filter((m) => m.devolucion === codigo);
const reenviar = (id, token = entorno.TOKEN_ADMIN) => fetch(`${entorno.base}/api/integraciones/mensajes/${id}/reenviar`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

test("reenvia cada tipo de aviso en Error: vuelve a Enviado con un NUEVO messageId y la MISMA idempotency_key", async () => {
  const codigo = await conTresErrores();
  const antes = await lista(codigo);
  assert.deepEqual(antes.map((m) => m.estado), ["Error", "Error", "Error"]);
  for (const m of antes) {
    const r = await reenviar(m.id);
    assert.equal(r.status, 200, m.id);
    assert.equal(r.cuerpo.data.estado, "Enviado");
    assert.match(r.cuerpo.data.message_id, /^fake-msg-\d+$/);
    assert.equal(r.cuerpo.data.puede_reenviar, false);
  }
  assert.equal(entorno.pubsub.publicados.length, 3);
  const claves = entorno.pubsub.publicados.map((p) => p.attributes.idempotency_key).sort();
  assert.match(claves.find((c) => c.startsWith("nc-")), /^nc-\d{6}$/);
  assert.ok(claves.includes(codigo)); // Compras: el codigo de la devolucion
  assert.ok(claves.includes(`${codigo}-APROBADA`)); // Marketplace
  assert.deepEqual((await lista(codigo)).map((m) => m.estado), ["Enviado", "Enviado", "Enviado"]);
});

test("si el reenvio vuelve a fallar responde 200 con el estado en que quedo (Error o Pendiente)", async () => {
  const codigo = await conTresErrores();
  const [uno] = await lista(codigo);
  entorno.pubsub.falla = Object.assign(new Error("UNAVAILABLE"), { code: 14 });
  const r = await reenviar(uno.id);
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.data.estado, "Pendiente"); // fallo reintentable: queda para los reintentos automaticos
  assert.equal(r.cuerpo.mensaje, "Mensaje reenviado");
});

test("solo los envios en Error: uno Enviado da 409; id inexistente 404; id con formato invalido 400", async () => {
  const codigo = await conTresErrores();
  const [uno] = await lista(codigo);
  assert.equal((await reenviar(uno.id)).status, 200);
  const otra = await reenviar(uno.id);
  assert.equal(otra.status, 409);
  assert.match(otra.cuerpo.mensaje, /Solo se pueden reenviar los envíos con estado Error \(este está Enviado\)/);
  assert.equal((await reenviar("compras-999999999")).status, 404);
  for (const id of ["compras", "ventas-1", "compras-x", "1"]) assert.equal((await reenviar(id)).status, 400, id);
});

test("solo el administrador: sin token 401, cajero 403, y no se publica nada", async () => {
  const codigo = await conTresErrores();
  const [uno] = await lista(codigo);
  assert.equal((await reenviar(uno.id, null)).status, 401);
  assert.equal((await reenviar(uno.id, "CAJERO-TEST")).status, 403);
  assert.equal(entorno.pubsub.publicados.length, 0);
});
