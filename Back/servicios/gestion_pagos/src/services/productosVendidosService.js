const { AppError } = require("../utils/AppError");
const repo = require("../data/productosVendidosRepo");
const enviosRepo = require("../data/enviosComprasRepo");
const { publicar } = require("../clients/pubsubPublisher");
const cfg = require("../config/compras");
const { GRUPOS, GRUPO_ORIGEN_DEFECTO, buscarPorGrupo, slugificarOrigen } = require("../config/pubsubGrupos");
const pubsubVerificacionesRepo = require("../data/pubsubVerificacionesRepo");

/**
 * TDSI-54/185: productos vendidos de un dia (fecha "YYYY-MM-DD"), agrupados por
 * producto, ordenados de mas a menos vendido, sin contar facturas anuladas.
 */
async function obtenerProductosVendidos(fecha) {
  if (!fecha) {
    throw new AppError("Falta la fecha para agrupar los productos vendidos.", 400);
  }
  const desde = new Date(`${fecha}T00:00:00`);
  const hasta = new Date(`${fecha}T23:59:59.999`);
  if (Number.isNaN(desde.getTime())) {
    throw new AppError("La fecha no es válida.", 400, { fecha });
  }

  const productos = await repo.agruparPorProducto(desde, hasta);
  return { fecha, productos };
}

/**
 * TDSI-54/682/697: arma y publica el reporte del dia en "pagos-productos-vendidos", con
 * un identificador unico por fecha ("PV-<fecha>") para que Compras lo pueda tratar como
 * idempotente, y deja el intento registrado en pagos.envios_compras (TDSI-687) --
 * Enviado o Error -- para que la lectura del acuse (TDSI-697) sepa que marcar como
 * Recibido. "Si no hubo ventas ese dia, no se puede enviar" (regla del ticket). La
 * regla de "una vez por dia salvo Error" la aplica enviarACompras (TDSI-702), no esta
 * funcion -- publicarProductosVendidos se puede llamar mas de una vez (p.ej. un reenvio).
 *
 * TDSI-964: el mensaje va en el mismo sobre que Contabilidad/Marketplace/"Verificación de
 * Pub/Sub" (sistema_origen/referencia_externa/tipo_operacion/fecha_documento/datos). El
 * destino SIEMPRE es Compras (no es seleccionable); `grupoOrigen` (A1 por defecto, el
 * real) solo simula, para pruebas, desde que grupo se manda. Todo intento queda ademas en
 * el log compartido pagos.pubsub_verificaciones.
 */
async function publicarProductosVendidos(fecha, { grupoOrigen, enviadoPor } = {}) {
  const { productos } = await obtenerProductosVendidos(fecha);
  if (productos.length === 0) {
    throw new AppError("No hubo ventas ese día; no se puede enviar a Compras.", 409, { fecha });
  }

  const origen = buscarPorGrupo(grupoOrigen || GRUPO_ORIGEN_DEFECTO);
  if (!origen) {
    throw new AppError(`El tópico origen debe ser uno de: ${GRUPOS.map((g) => g.grupo).join(", ")}.`, 400, { grupo_origen: grupoOrigen });
  }

  const reporteId = `PV-${fecha}`;
  const mensaje = {
    sistema_origen: slugificarOrigen(origen.nombre),
    referencia_externa: reporteId,
    tipo_operacion: "productos_vendidos",
    fecha_documento: fecha,
    datos: {
      productos,
      generado_en: new Date().toISOString(),
    },
  };

  const resultado = await publicar(cfg.PUBSUB_TOPIC, mensaje, {
    tipo: "PRODUCTOS_VENDIDOS",
    tipo_operacion: "productos_vendidos",
    fecha,
    referencia_externa: reporteId,
    idempotency_key: reporteId,
    origen: "gestion_pagos",
    grupo: origen.grupo,
  });

  const envio = resultado.ok
    ? await enviosRepo.registrarEnviado(fecha, { reporteId, payload: mensaje, messageId: resultado.messageId })
    : await enviosRepo.registrarError(fecha, { reporteId, payload: mensaje, error: resultado.error });

  try {
    await pubsubVerificacionesRepo.registrar({
      grupo: "C",
      grupo_origen: origen.grupo,
      topico: cfg.PUBSUB_TOPIC,
      mensaje: `productos_vendidos ${reporteId}`,
      payload_enviado: mensaje,
      ok: resultado.ok,
      message_id: resultado.ok ? resultado.messageId : null,
      error: resultado.ok ? null : resultado.error,
      enviado_por: enviadoPor || null,
    });
  } catch (e) {
    console.error("No se pudo registrar el envío a Compras en el log de Pub/Sub:", e.message);
  }

  return { mensaje, resultado, envio };
}

/**
 * TDSI-54/702: lo que pide "Productos Vendidos" del Administrador -- la lista del dia
 * mas el estado del envio a Compras, si ya se intento alguno.
 */
async function obtenerConEstadoEnvio(fecha) {
  const resultado = await obtenerProductosVendidos(fecha);
  const envio = await enviosRepo.obtenerPorFecha(fecha);
  return {
    ...resultado,
    envio: envio
      ? { estado: envio.estado, intentos: envio.intentos, ultimoError: envio.ultimo_error, enviadoEn: envio.enviado_en, recibidoEn: envio.recibido_en }
      : null,
  };
}

/**
 * TDSI-54/702: boton "Enviar a Compras". "Cada dia se envia una sola vez, salvo que el
 * envio haya quedado en Error" (regla del ticket) -- si ya hay un envio Enviado o
 * Recibido para esa fecha, no se vuelve a publicar.
 */
async function enviarACompras(fecha, { grupoOrigen, enviadoPor } = {}) {
  if (!fecha) {
    throw new AppError("Falta la fecha para enviar el reporte a Compras.", 400);
  }
  const envioExistente = await enviosRepo.obtenerPorFecha(fecha);
  if (envioExistente && envioExistente.estado !== "Error") {
    throw new AppError(
      `El reporte de ese día ya se envió (estado: ${envioExistente.estado}). Solo se puede reenviar si quedó en Error.`,
      409,
      { fecha, estado: envioExistente.estado }
    );
  }
  return publicarProductosVendidos(fecha, { grupoOrigen, enviadoPor });
}

module.exports = { obtenerProductosVendidos, publicarProductosVendidos, obtenerConEstadoEnvio, enviarACompras };
