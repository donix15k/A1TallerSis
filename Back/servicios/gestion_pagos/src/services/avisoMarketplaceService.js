const { publicar } = require("../clients/pubsubPublisher");
const cfg = require("../config/marketplace");
const repo = require("../data/ventasOnlineRepo");
const { obtenerOCrearTokenVentaOnline, urlVerificacion } = require("./verificacionFacturaService");
const { enviarFacturaDeVentaOnline } = require("./facturaDigitalService");
const { AppError } = require("../utils/AppError");
const { GRUPOS, buscarPorGrupo, slugificarOrigen, fechaDocumentoHoy } = require("../config/pubsubGrupos");
const pubsubVerificacionesRepo = require("../data/pubsubVerificacionesRepo");

/**
 * TDSI-51/684: avisa al Marketplace que la factura de su orden ya se emitio, publicando
 * en "pagos-facturas-emitidas" el N de orden, el N de factura y el enlace publico
 * "Verificar Factura" (mismo token+QR que las ventas de mostrador, TDSI-38/527). Guarda
 * el resultado (Enviado/Error) en la propia venta. Sin topico configurado no se intenta
 * ni se registra nada (desarrollo local sin credenciales) -- igual que Contabilidad.
 *
 * TDSI-964: el mensaje va siempre envuelto en el mismo sobre que ya usan Contabilidad y
 * "Verificación de Pub/Sub" (sistema_origen/referencia_externa/tipo_operacion/
 * fecha_documento/datos). El destino SIEMPRE es Marketplace (no es seleccionable); solo
 * `grupoOrigen` (A por defecto, el real) simula desde que grupo se manda, igual que en
 * "Verificación de Pub/Sub". Todo intento (con o sin origen simulado) queda tambien en
 * el log compartido pagos.pubsub_verificaciones.
 */
async function avisarFacturaEmitida({ id, orden_id, numero_factura, grupoOrigen, enviadoPor }) {
  if (!cfg.FACTURAS_TOPIC) return { publicado: false, motivo: "MARKETPLACE_FACTURAS_TOPIC no esta configurado" };

  const origen = buscarPorGrupo(grupoOrigen || "A");
  if (!origen) {
    throw new AppError(`El tópico origen debe ser uno de: ${GRUPOS.map((g) => g.grupo).join(", ")}.`, 400, { grupo_origen: grupoOrigen });
  }

  const token = await obtenerOCrearTokenVentaOnline(id);
  const mensaje = {
    sistema_origen: slugificarOrigen(origen.nombre),
    referencia_externa: numero_factura,
    tipo_operacion: "factura_emitida",
    fecha_documento: fechaDocumentoHoy(),
    datos: {
      orden_id,
      numero_factura,
      enlace_verificacion: urlVerificacion(token),
      // Fecha/hora exacta del aviso (el Marketplace la pidió clara en el cuerpo del mensaje,
      // igual que ya la tienen los mensajes hacia Compras y Contabilidad).
      emitido_en: new Date().toISOString(),
    },
  };

  const r = await publicar(cfg.FACTURAS_TOPIC, mensaje, {
    tipo: "FACTURA_EMITIDA",
    tipo_operacion: "factura_emitida",
    referencia_externa: numero_factura,
    origen: "gestion_pagos",
    grupo: origen.grupo,
  });
  await repo.guardarAvisoMarketplace(id, { estado: r.ok ? "Enviado" : "Error", error: r.ok ? null : r.error });

  try {
    await pubsubVerificacionesRepo.registrar({
      grupo: "E",
      grupo_origen: origen.grupo,
      topico: cfg.FACTURAS_TOPIC,
      mensaje: `factura_emitida ${numero_factura}`,
      payload_enviado: mensaje,
      ok: r.ok,
      message_id: r.ok ? r.messageId : null,
      error: r.ok ? null : r.error,
      enviado_por: enviadoPor || null,
    });
  } catch (e) {
    console.error("No se pudo registrar el aviso a Marketplace en el log de Pub/Sub:", e.message);
  }

  return { publicado: r.ok, ...(r.ok ? { messageId: r.messageId } : { error: r.error }) };
}

/**
 * TDSI-51/957: boton "Aprobar y enviar a Marketplace" del modal de factura del
 * Administrador -- es el unico momento en que la orden sale de nuestro sistema:
 * se publica el aviso Pub/Sub al Marketplace y, si la orden trajo un correo, se le
 * manda ademas la factura digital al cliente (sin correo, simplemente no se le manda
 * nada por ahi). Las dos cosas son independientes: que una falle no frena la otra.
 * Solo tiene sentido si la orden ya tiene una factura emitida.
 *
 * TDSI-964: `grupoOrigen` (opcional) simula, solo para pruebas, que el aviso viene de
 * otro grupo del proyecto -- Marketplace siempre lo recibe igual, eso nunca cambia.
 */
async function reenviarAvisoMarketplace(ventaId, { grupoOrigen, enviadoPor } = {}) {
  const venta = await repo.obtenerVentaPorId(ventaId);
  if (!venta) throw new AppError("No existe una venta online con ese id.", 404, { id: ventaId });
  if (!venta.numero_factura) {
    throw new AppError("Esta orden todavía no tiene una factura emitida; no hay nada que avisar al Marketplace.", 409, { id: ventaId });
  }

  const aviso = await avisarFacturaEmitida({
    id: venta.id, orden_id: venta.orden_id, numero_factura: venta.numero_factura, grupoOrigen, enviadoPor,
  });

  let facturaEmail = null;
  if (venta.email) {
    const items = await repo.obtenerItemsVenta(venta.id);
    facturaEmail = await enviarFacturaDeVentaOnline({ venta, items, numeroFactura: venta.numero_factura });
  }

  return { ...aviso, facturaEmail };
}

module.exports = { avisarFacturaEmitida, reenviarAvisoMarketplace };
