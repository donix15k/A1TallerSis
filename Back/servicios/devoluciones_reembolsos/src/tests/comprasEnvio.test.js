// TDSI-104: al procesar la devolucion se avisa a Compras (topico ucb-sis323-sub-c) con idempotency_key = codigo de la
// devolucion, guardando messageId y estado. Pub/Sub FALSO (nunca se publica de verdad); BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const cfg = require("../config/compras");
const repo = require("../data/enviosComprasRepo");
const compras = require("../services/comprasService");
const { armarMensajeProductosDevueltos } = require("../services/comprasMensaje");
const { iniciarEntorno } = require("./helpers/entorno");

const TOPICO = "projects/project-test-12345/topics/ucb-sis323-sub-c";
let entorno;
let motivoId;
let contador = 0;
let topicoOriginal;
const CAJERO = "cajero.compras@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  topicoOriginal = cfg.PUBSUB_TOPIC;
  cfg.PUBSUB_TOPIC = TOPICO; // la integracion con Compras se prende solo dentro de esta prueba
});
test.beforeEach(() => {
  entorno.pubsub.publicados.length = 0;
  entorno.pubsub.falla = null;
});
test.after(async () => {
  cfg.PUBSUB_TOPIC = topicoOriginal;
  await entorno.cerrar();
});

async function aprobada(items) {
  const numero = entorno.agregarFactura(20 + ++contador, {
    metodosPago: [{ metodo: "QR", monto: 100 }],
    items: [{ descripcion: "Producto A", cantidad: "5.00", precio_unitario: "10.00", subtotal: "50.00" }, { descripcion: "Producto B", cantidad: "2.00", precio_unitario: "25.00", subtotal: "50.00" }],
  });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items, motivo_id: motivoId, cajero: CAJERO });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  return cuerpo.data.codigo;
}
const MIXTA = [
  { descripcion: "Producto A", cantidad: 2, estado_producto: "BUEN_ESTADO" },
  { descripcion: "Producto B", cantidad: 1, estado_producto: "DEFECTUOSO" },
];
const reembolsar = (codigo) => entorno.post(`/api/devoluciones/${codigo}/reembolsar`, { cajero: CAJERO });
const aCompras = () => entorno.pubsub.publicados.filter((p) => p.topico === TOPICO);

test("al procesar la devolucion se publica UN aviso en el topico de Compras con idempotency_key = codigo de la devolucion", async () => {
  const codigo = await aprobada(MIXTA);
  const r = await reembolsar(codigo);
  assert.equal(r.status, 201);
  assert.equal(aCompras().length, 1);
  const { json, attributes, topico } = aCompras()[0];
  assert.match(topico, /\/topics\/ucb-sis323-sub-c$/);
  assert.equal(json.tipo_operacion, "productos_devueltos");
  assert.equal(json.referencia_externa, codigo);
  assert.deepEqual(json.datos.productos, [
    { descripcion: "Producto A", cantidad: 2, estado_producto: "BUEN_ESTADO" },
    { descripcion: "Producto B", cantidad: 1, estado_producto: "DEFECTUOSO" },
  ]);
  assert.equal(json.datos.hay_defectuosos, true);
  assert.deepEqual(attributes, {
    tipo: "PRODUCTOS_DEVUELTOS",
    tipo_operacion: "productos_devueltos",
    referencia_externa: codigo,
    idempotency_key: codigo,
    origen: "devoluciones",
    grupo: "A1",
  });
});

test("queda registrado: estado Enviado, 1 intento y el messageId; el reembolso responde con el estado de Compras", async () => {
  const codigo = await aprobada(MIXTA);
  const r = await reembolsar(codigo);
  const e = await repo.obtenerPorCodigo(codigo, { conPayload: true });
  assert.deepEqual([e.estado, e.intentos, e.ultimo_error, e.proximo_intento_en, e.idempotency_key], ["Enviado", 1, null, null, codigo]);
  assert.match(e.pubsub_message_id, /^fake-msg-\d+$/);
  assert.ok(e.enviado_en);
  assert.deepEqual(r.cuerpo.data.compras, { estado: "Enviado", intentos: 1, pubsub_message_id: e.pubsub_message_id });
  assert.deepEqual(e.payload, aCompras()[0].json);
});

test("cada devolucion se avisa UNA sola vez: reintentar el aviso no publica otra vez", async () => {
  const codigo = await aprobada(MIXTA);
  await reembolsar(codigo);
  const otra = await compras.enviarDevolucion(codigo);
  assert.equal(otra.idempotency_key, codigo);
  assert.equal(aCompras().length, 1);
  assert.equal((await query(`SELECT count(*)::int n FROM devoluciones.envios_compras_dev e JOIN devoluciones.devoluciones d ON d.id = e.devolucion_id WHERE d.codigo = $1`, [codigo])).rows[0].n, 1);
});

test("dos avisos a la vez de la misma devolucion: se publica una sola vez", async () => {
  const codigo = await aprobada(MIXTA);
  entorno.pubsub.falla = new Error("todavia no");
  await reembolsar(codigo);
  await query(`DELETE FROM devoluciones.envios_compras_dev WHERE devolucion_id = (SELECT id FROM devoluciones.devoluciones WHERE codigo = $1)`, [codigo]);
  entorno.pubsub.falla = null;
  entorno.pubsub.publicados.length = 0;
  await Promise.all([compras.enviarDevolucion(codigo), compras.enviarDevolucion(codigo)]);
  assert.equal(aCompras().length, 1);
});

test("si Pub/Sub falla, el reembolso igual se hace: el aviso queda Pendiente con su error y la hora del reintento", async () => {
  const codigo = await aprobada(MIXTA);
  entorno.pubsub.falla = Object.assign(new Error("UNAVAILABLE"), { code: 14 });
  const r = await reembolsar(codigo);
  assert.equal(r.status, 201);
  assert.equal(r.cuerpo.data.estado, "PROCESADA");
  const e = await repo.obtenerPorCodigo(codigo);
  assert.deepEqual([e.estado, e.intentos, e.pubsub_message_id], ["Pendiente", 1, null]);
  assert.match(e.ultimo_error, /UNAVAILABLE/);
  assert.ok(new Date(e.proximo_intento_en) > new Date());
  assert.equal(r.cuerpo.data.compras.estado, "Pendiente");
});

test("un fallo que no se arregla reintentando (sin permiso) deja el aviso en Error de inmediato", async () => {
  const codigo = await aprobada(MIXTA);
  entorno.pubsub.falla = Object.assign(new Error("PERMISSION_DENIED"), { code: 7 });
  await reembolsar(codigo);
  const e = await repo.obtenerPorCodigo(codigo);
  assert.deepEqual([e.estado, e.intentos, e.proximo_intento_en], ["Error", 1, null]);
});

test("sin COMPRAS_PUBSUB_TOPIC no se publica ni se registra nada, y el reembolso funciona igual", async () => {
  cfg.PUBSUB_TOPIC = null;
  try {
    const codigo = await aprobada(MIXTA);
    const r = await reembolsar(codigo);
    assert.equal(r.status, 201);
    assert.deepEqual([r.cuerpo.data.compras.estado, r.cuerpo.data.compras.publicado], [null, false]);
    assert.equal(aCompras().length, 0);
    assert.equal(await repo.obtenerPorCodigo(codigo), null);
  } finally {
    cfg.PUBSUB_TOPIC = TOPICO;
  }
});

test("una devolucion que no esta PROCESADA no se avisa (409) y el mensaje es el mismo que arma comprasMensaje", async () => {
  const codigo = await aprobada(MIXTA);
  await assert.rejects(compras.enviarDevolucion(codigo), (e) => e.status === 409);
  await reembolsar(codigo);
  const d = (await entorno.get(`/api/devoluciones/${codigo}`)).cuerpo.data;
  const procesada = d.historial.find((h) => h.estado_nuevo === "PROCESADA");
  assert.deepEqual(aCompras()[0].json, armarMensajeProductosDevueltos({ devolucion: d, procesadaEn: procesada.cambiado_en }));
});
