// TDSI-117: aviso al Marketplace (Grupo E) del resultado de una devolucion de un pedido online, por Pub/Sub, en su topico
// (ucb-sis323-sub-e): DEVOLUCION_RESUELTA con la orden, aprobada/rechazada, el monto reembolsado y el N° de nota de credito
// o el motivo del rechazo. Asincrono: se publica y no se espera.
const repo = require("../data/enviosMarketplaceRepo");
const notasCreditoRepo = require("../data/notasCreditoRepo");
const { publicar } = require("../clients/pubsubPublisher");
const cfg = require("../config/marketplace");
const { armarMensajeDevolucionResuelta } = require("./marketplaceMensaje");
const devolucionService = require("./devolucionService");
const { query } = require("../config/db");
const { AppError } = require("../utils/AppError");

/** Un intento de publicacion; deja registrado el resultado (messageId o error con su reintento). */
async function intentarEnvio(envio) {
  const payload = envio.payload || (await repo.obtener(envio.id, { conPayload: true })).payload;
  const r = await publicar(
    payload,
    {
      tipo: "DEVOLUCION_RESUELTA",
      tipo_operacion: payload.tipo_operacion,
      referencia_externa: payload.referencia_externa,
      orden_id: payload.datos.orden_id,
      resultado: payload.datos.resultado,
      idempotency_key: `${payload.referencia_externa}-${payload.datos.resultado.toUpperCase()}`,
      origen: "devoluciones",
      grupo: cfg.GRUPO_ORIGEN,
    },
    { topico: cfg.PUBSUB_TOPIC, variable: "MARKETPLACE_PUBSUB_TOPIC" }
  );
  if (r.ok) return repo.marcarEnviado(envio.id, r.messageId);
  return repo.registrarFallo(envio.id, r, cfg.MAX_INTENTOS, cfg.BACKOFF_BASE_SEG);
}

/**
 * Avisa el resultado de una devolucion del MARKETPLACE: PROCESADA -> aprobada (con monto y N° de nota de credito),
 * RECHAZADA -> rechazada (con el motivo). Las de la tienda no se avisan. Cada resultado se avisa una sola vez. Sin
 * MARKETPLACE_PUBSUB_TOPIC no registra nada.
 */
async function avisarResultado(codigo) {
  if (!cfg.PUBSUB_TOPIC) return { publicado: false, motivo: "MARKETPLACE_PUBSUB_TOPIC no esta configurado" };

  const devolucion = await devolucionService.obtenerDevolucion(codigo); // 404 si no existe
  if (devolucion.origen !== "MARKETPLACE") return { publicado: false, motivo: "La devolución no es del Marketplace" };

  const resultado = devolucion.estado === "PROCESADA" ? "APROBADA" : devolucion.estado === "RECHAZADA" ? "RECHAZADA" : null;
  if (!resultado) {
    throw new AppError(`La devolución ${devolucion.codigo} está ${devolucion.estado}: solo se avisa al Marketplace cuando queda reembolsada o rechazada.`, 409, { codigo: devolucion.codigo, estado: devolucion.estado });
  }
  const { rows } = await query(`SELECT id FROM devoluciones.devoluciones WHERE codigo = $1`, [devolucion.codigo]);
  const devolucionId = Number(rows[0].id);
  const nota = resultado === "APROBADA" ? await notasCreditoRepo.obtenerPorDevolucion(devolucionId) : null;
  const evento = devolucion.historial.find((h) => h.estado_nuevo === devolucion.estado);

  const payload = armarMensajeDevolucionResuelta({ devolucion, resultado, notaNumero: nota?.numero ?? null, resueltaEn: evento?.cambiado_en || new Date() });
  const { envio, yaExiste } = await repo.crear({ devolucionId, codigo: devolucion.codigo, resultado, payload });
  if (yaExiste) return yaExiste;
  return intentarEnvio({ ...envio, payload });
}

/** Nunca hace fallar la operacion principal (reembolsar o rechazar): si algo sale mal lo informa en { error }. */
async function avisarResultadoSeguro(codigo) {
  try {
    return await avisarResultado(codigo);
  } catch (e) {
    console.error(`[marketplace] No se pudo avisar el resultado de la devolucion ${codigo}:`, e.message);
    return { publicado: false, error: e.message };
  }
}

module.exports = { avisarResultado, avisarResultadoSeguro, intentarEnvio };
