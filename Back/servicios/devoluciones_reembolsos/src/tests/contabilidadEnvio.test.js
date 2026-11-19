// TDSI-92: al procesar una devolucion su nota de credito se publica en Contabilidad (Pub/Sub FALSO: nunca se publica de
// verdad), con envios_contabilidad_nc, messageId, estado e idempotencia. BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const cfg = require("../config/contabilidad");
const repo = require("../data/enviosContabilidadRepo");
const contabilidad = require("../services/contabilidadService");
const { armarMensajeNotaCredito, claveIdempotencia } = require("../services/contabilidadMensaje");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.contab@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});
test.beforeEach(() => {
  entorno.pubsub.publicados.length = 0;
  entorno.pubsub.falla = null;
});
test.after(() => entorno.cerrar());

async function aprobada() {
  const numero = entorno.agregarFactura(100 + ++contador, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 2 }], motivo_id: motivoId, cajero: CAJERO, observaciones: "caja rota" });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  return cuerpo.data.codigo;
}
const reembolsar = (codigo) => entorno.post(`/api/devoluciones/${codigo}/reembolsar`, { cajero: CAJERO });
const envioDe = (codigo) => repo.obtenerPorDevolucionCodigo(codigo, { conPayload: true });

test("al procesar la devolucion se publica UN mensaje NOTA_CREDITO con el formato de Contabilidad y sus atributos", async () => {
  const codigo = await aprobada();
  const r = await reembolsar(codigo);
  assert.equal(r.status, 201);
  assert.equal(entorno.pubsub.publicados.length, 1);
  const { json, attributes } = entorno.pubsub.publicados[0];
  const nota = r.cuerpo.data.nota_credito;
  assert.equal(json.sistema_origen, "FACTURACION");
  assert.equal(json.tipo_operacion, "nota_credito");
  assert.equal(json.referencia_externa, nota.numero);
  assert.equal(json.datos.id_documento_original, (await entorno.get(`/api/devoluciones/${codigo}`)).cuerpo.data.factura_numero);
  assert.equal(json.datos.monto, 20);
  assert.equal(json.datos.motivo, `Devolución ${codigo}: ${(await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].nombre} (caja rota)`);
  assert.deepEqual(attributes, {
    tipo: "NOTA_CREDITO",
    tipo_operacion: "nota_credito",
    referencia_externa: nota.numero,
    idempotency_key: claveIdempotencia(nota.numero),
    origen: "devoluciones",
    grupo: "A1",
  });
  assert.match(attributes.idempotency_key, /^nc-\d{6}$/);
});

test("queda registrado: estado Enviado, 1 intento y el messageId que devolvio Pub/Sub; el reembolso responde con el estado", async () => {
  const codigo = await aprobada();
  const r = await reembolsar(codigo);
  const e = await envioDe(codigo);
  assert.deepEqual([e.estado, e.intentos, e.ultimo_error, e.proximo_intento_en], ["Enviado", 1, null, null]);
  assert.match(e.pubsub_message_id, /^fake-msg-\d+$/);
  assert.ok(e.enviado_en);
  assert.equal(e.idempotency_key, claveIdempotencia(r.cuerpo.data.nota_credito.numero));
  assert.deepEqual(r.cuerpo.data.contabilidad, { estado: "Enviado", intentos: 1, pubsub_message_id: e.pubsub_message_id });
  assert.deepEqual(e.payload, entorno.pubsub.publicados[0].json); // lo guardado es lo que se publico
});

test("cada nota se envia UNA sola vez: reintentar enviarNota devuelve el envio existente y no publica otra vez", async () => {
  const codigo = await aprobada();
  await reembolsar(codigo);
  const antes = await envioDe(codigo);
  const otra = await contabilidad.enviarNota(codigo);
  assert.equal(otra.id, antes.id);
  assert.equal(entorno.pubsub.publicados.length, 1);
  assert.equal((await query(`SELECT count(*)::int n FROM devoluciones.envios_contabilidad_nc e JOIN devoluciones.notas_credito n ON n.id = e.nota_credito_id JOIN devoluciones.devoluciones d ON d.id = n.devolucion_id WHERE d.codigo = $1`, [codigo])).rows[0].n, 1);
});

test("dos envios a la vez de la misma nota: se publica una sola vez", async () => {
  const codigo = await aprobada();
  entorno.pubsub.falla = new Error("no publicar todavia");
  await reembolsar(codigo); // queda Pendiente (la publicacion fallo)
  entorno.pubsub.falla = null;
  await query(`DELETE FROM devoluciones.envios_contabilidad_nc WHERE nota_credito_id = (SELECT n.id FROM devoluciones.notas_credito n JOIN devoluciones.devoluciones d ON d.id = n.devolucion_id WHERE d.codigo = $1)`, [codigo]);
  entorno.pubsub.publicados.length = 0;
  await Promise.all([contabilidad.enviarNota(codigo), contabilidad.enviarNota(codigo)]);
  assert.equal(entorno.pubsub.publicados.length, 1);
});

test("si Pub/Sub falla (red), el reembolso igual se hace: el envio queda Pendiente con su error y la hora del reintento", async () => {
  const codigo = await aprobada();
  entorno.pubsub.falla = Object.assign(new Error("UNAVAILABLE"), { code: 14 });
  const r = await reembolsar(codigo);
  assert.equal(r.status, 201);
  assert.equal(r.cuerpo.data.estado, "PROCESADA");
  const e = await envioDe(codigo);
  assert.deepEqual([e.estado, e.intentos, e.pubsub_message_id], ["Pendiente", 1, null]);
  assert.match(e.ultimo_error, /UNAVAILABLE/);
  assert.ok(new Date(e.proximo_intento_en) > new Date());
  assert.equal(r.cuerpo.data.contabilidad.estado, "Pendiente");
});

test("un fallo que no se arregla reintentando (sin permiso) deja el envio en Error de inmediato", async () => {
  const codigo = await aprobada();
  entorno.pubsub.falla = Object.assign(new Error("PERMISSION_DENIED"), { code: 7 });
  const r = await reembolsar(codigo);
  assert.equal(r.status, 201);
  const e = await envioDe(codigo);
  assert.deepEqual([e.estado, e.intentos, e.proximo_intento_en], ["Error", 1, null]);
  assert.equal(r.cuerpo.data.contabilidad.estado, "Error");
});

test("sin CONTABILIDAD_PUBSUB_TOPIC no se publica ni se registra nada, y el reembolso funciona igual", async () => {
  const topico = cfg.PUBSUB_TOPIC;
  cfg.PUBSUB_TOPIC = null;
  try {
    const codigo = await aprobada();
    const r = await reembolsar(codigo);
    assert.equal(r.status, 201);
    assert.deepEqual([r.cuerpo.data.contabilidad.estado, r.cuerpo.data.contabilidad.publicado], [null, false]);
    assert.equal(entorno.pubsub.publicados.length, 0);
    assert.equal(await envioDe(codigo), null);
  } finally {
    cfg.PUBSUB_TOPIC = topico;
  }
});

test("el formato publicado es el mismo que arma contabilidadMensaje (no hay dos versiones del mensaje)", async () => {
  const codigo = await aprobada();
  const r = await reembolsar(codigo);
  const d = (await entorno.get(`/api/devoluciones/${codigo}`)).cuerpo.data;
  const esperado = armarMensajeNotaCredito({
    nota: r.cuerpo.data.nota_credito,
    devolucion: d,
    factura: { cliente_nit: "1234567", cliente_nombre: "Cliente de prueba" },
  });
  assert.deepEqual(entorno.pubsub.publicados[0].json, esperado);
});
