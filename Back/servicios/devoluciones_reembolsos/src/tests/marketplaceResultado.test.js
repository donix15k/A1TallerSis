// TDSI-117: DEVOLUCION_RESUELTA al Marketplace (topico ucb-sis323-sub-e): aprobada con la nota de credito, o rechazada con el
// motivo. Pub/Sub FALSO (nunca se publica de verdad); BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const cfg = require("../config/marketplace");
const repo = require("../data/enviosMarketplaceRepo");
const marketplace = require("../services/marketplaceService");
const { armarMensajeDevolucionResuelta } = require("../services/marketplaceMensaje");
const { reintentarPendientes } = require("../jobs/reintentoEnviosContabilidad");
const { iniciarEntorno } = require("./helpers/entorno");

const TOPICO = "projects/project-test-12345/topics/ucb-sis323-sub-e";
let entorno;
let motivoId;
let contador = 0;
let topicoOriginal;
const CAJERO = "cajero.mktres@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  topicoOriginal = cfg.PUBSUB_TOPIC;
  cfg.PUBSUB_TOPIC = TOPICO;
});
test.beforeEach(() => {
  entorno.pubsub.publicados.length = 0;
  entorno.pubsub.falla = null;
});
test.after(async () => {
  cfg.PUBSUB_TOPIC = topicoOriginal;
  await entorno.cerrar();
});

/** Devolucion PENDIENTE de un pedido del Marketplace (o de la tienda si esMarketplace = false). */
async function pendiente({ esMarketplace = true } = {}) {
  const numero = entorno.agregarFactura(70 + ++contador, { canal: esMarketplace ? "Online" : "Presencial", metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", {
    factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 3, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: esMarketplace ? "MARKETPLACE" : CAJERO,
  });
  if (esMarketplace) await query(`UPDATE devoluciones.devoluciones SET origen = 'MARKETPLACE', orden_id = $2 WHERE codigo = $1`, [cuerpo.data.codigo, `ORD-${cuerpo.data.codigo}`]);
  return cuerpo.data.codigo;
}
const aprobar = (c) => entorno.post(`/api/devoluciones/${c}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
const reembolsar = (c) => entorno.post(`/api/devoluciones/${c}/reembolsar`, { cajero: CAJERO });
const rechazar = (c, motivo = "El producto no cumple la politica de cambios") => entorno.post(`/api/devoluciones/${c}/rechazar`, { supervisor_id: "SUP-OK", pin: "1234", motivo_rechazo: motivo });
const aE = () => entorno.pubsub.publicados.filter((p) => p.topico === TOPICO);

test("formato puro: aprobada lleva monto y nota de credito; rechazada lleva el motivo y monto 0", () => {
  const base = { codigo: "DEV-0042", orden_id: "ORD-77", monto_total: 30, motivo_rechazo: "No cumple la politica" };
  const ap = armarMensajeDevolucionResuelta({ devolucion: base, resultado: "APROBADA", notaNumero: "NC-000009", resueltaEn: "2026-03-10T14:00:00.000Z" });
  assert.deepEqual([ap.sistema_origen, ap.referencia_externa, ap.tipo_operacion, ap.fecha_documento], ["GESTION_DE_PAGOS_Y_FACTURACION", "DEV-0042", "devolucion_resuelta", "2026-03-10"]);
  assert.deepEqual(ap.datos, { orden_id: "ORD-77", codigo_devolucion: "DEV-0042", resultado: "aprobada", monto_reembolsado: 30, numero_nota_credito: "NC-000009", motivo_rechazo: null, generado_en: "2026-03-10T14:00:00.000Z" });
  const re = armarMensajeDevolucionResuelta({ devolucion: base, resultado: "RECHAZADA", resueltaEn: "2026-03-10T14:00:00.000Z" });
  assert.deepEqual([re.datos.resultado, re.datos.monto_reembolsado, re.datos.numero_nota_credito, re.datos.motivo_rechazo], ["rechazada", 0, null, "No cumple la politica"]);
});

test("al aprobar y reembolsar una devolucion del Marketplace, recibe aprobada con la orden, el monto y el N de nota de credito", async () => {
  const codigo = await pendiente();
  await aprobar(codigo);
  const r = await reembolsar(codigo);
  assert.equal(r.status, 201);
  assert.equal(aE().length, 1);
  const { json, attributes } = aE()[0];
  assert.equal(json.datos.orden_id, `ORD-${codigo}`);
  assert.deepEqual([json.tipo_operacion, json.referencia_externa, json.datos.resultado, json.datos.monto_reembolsado], ["devolucion_resuelta", codigo, "aprobada", 30]);
  assert.equal(json.datos.numero_nota_credito, r.cuerpo.data.nota_credito.numero);
  assert.deepEqual(attributes, {
    tipo: "DEVOLUCION_RESUELTA", tipo_operacion: "devolucion_resuelta", referencia_externa: codigo, orden_id: `ORD-${codigo}`,
    resultado: "aprobada", idempotency_key: `${codigo}-APROBADA`, origen: "devoluciones", grupo: "A1",
  });
  assert.equal(r.cuerpo.data.marketplace.estado, "Enviado");
});

test("al rechazar una devolucion del Marketplace, recibe rechazada con el motivo", async () => {
  const codigo = await pendiente();
  const r = await rechazar(codigo, "La orden ya fue entregada hace mas de un mes");
  assert.equal(r.status, 200);
  assert.equal(aE().length, 1);
  const { json } = aE()[0];
  assert.deepEqual([json.datos.resultado, json.datos.monto_reembolsado, json.datos.numero_nota_credito, json.datos.motivo_rechazo], ["rechazada", 0, null, "La orden ya fue entregada hace mas de un mes"]);
  assert.equal(r.cuerpo.data.marketplace.estado, "Enviado");
});

test("guarda el messageId y el estado; el mismo resultado se avisa UNA sola vez", async () => {
  const codigo = await pendiente();
  await aprobar(codigo);
  await reembolsar(codigo);
  const [e] = await repo.listarPorCodigo(codigo);
  assert.deepEqual([e.estado, e.intentos, e.resultado, e.idempotency_key], ["Enviado", 1, "APROBADA", `${codigo}-APROBADA`]);
  assert.match(e.pubsub_message_id, /^fake-msg-\d+$/);
  await marketplace.avisarResultado(codigo);
  assert.equal(aE().length, 1);
  assert.equal((await repo.listarPorCodigo(codigo)).length, 1);
});

test("las devoluciones de la TIENDA no se avisan al Marketplace", async () => {
  const codigo = await pendiente({ esMarketplace: false });
  await aprobar(codigo);
  const r = await reembolsar(codigo);
  assert.equal(r.status, 201);
  assert.equal(aE().length, 0);
  assert.equal(r.cuerpo.data.marketplace, null);
  assert.equal((await marketplace.avisarResultado(codigo)).publicado, false);
  const rr = await rechazar(await pendiente({ esMarketplace: false }));
  assert.equal(rr.cuerpo.data.marketplace, null);
  assert.equal(aE().length, 0);
});

test("si Pub/Sub falla, el reembolso y el rechazo igual se hacen; el aviso queda Pendiente y el proceso de reintentos lo envia", async () => {
  const codigo = await pendiente();
  await aprobar(codigo);
  entorno.pubsub.falla = Object.assign(new Error("UNAVAILABLE"), { code: 14 });
  const r = await reembolsar(codigo);
  assert.equal(r.status, 201);
  assert.equal(r.cuerpo.data.marketplace.estado, "Pendiente");
  assert.equal((await entorno.get(`/api/devoluciones/${codigo}`)).cuerpo.data.estado, "PROCESADA");

  const rechazada = await pendiente();
  const rr = await rechazar(rechazada);
  assert.equal(rr.status, 200);
  assert.equal(rr.cuerpo.data.marketplace.estado, "Pendiente");

  entorno.pubsub.falla = null;
  await query(`UPDATE devoluciones.envios_marketplace_dev SET proximo_intento_en = now() - interval '1 second' WHERE estado = 'Pendiente'`);
  const resultados = await reintentarPendientes();
  assert.ok(resultados.filter((x) => x.destino === "marketplace" && x.estado === "Enviado").length >= 2);
  assert.deepEqual([(await repo.listarPorCodigo(codigo))[0].estado, (await repo.listarPorCodigo(rechazada))[0].estado], ["Enviado", "Enviado"]);
});

test("sin MARKETPLACE_PUBSUB_TOPIC no se publica ni se registra nada y todo funciona igual", async () => {
  cfg.PUBSUB_TOPIC = null;
  try {
    const codigo = await pendiente();
    await aprobar(codigo);
    const r = await reembolsar(codigo);
    assert.equal(r.status, 201);
    assert.equal(r.cuerpo.data.marketplace, null);
    assert.equal(aE().length, 0);
    assert.equal((await repo.listarPorCodigo(codigo)).length, 0);
  } finally {
    cfg.PUBSUB_TOPIC = TOPICO;
  }
});

test("una devolucion que no esta reembolsada ni rechazada no se avisa (409)", async () => {
  const codigo = await pendiente();
  await assert.rejects(marketplace.avisarResultado(codigo), (e) => e.status === 409);
});
