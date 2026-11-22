// TDSI-92: envio de las notas de credito a Contabilidad (Grupo D) por Pub/Sub, de forma asincrona: se publica y no se
// espera; Contabilidad responde despues en nuestra suscripcion (TDSI-94).
const repo = require("../data/enviosContabilidadRepo");
const { registrarEnvio } = require("../utils/pubsubLog");
const notasCreditoRepo = require("../data/notasCreditoRepo");
const { publicar } = require("../clients/pubsubPublisher");
const cfg = require("../config/contabilidad");
const { armarMensajeNotaCredito, claveIdempotencia } = require("./contabilidadMensaje");
const devolucionService = require("./devolucionService");
const facturacionProxy = require("./facturacionProxy");
const { query } = require("../config/db");
const { AppError } = require("../utils/AppError");

/**
 * Un intento de publicacion; deja registrado el resultado. Con exito guarda el messageId que devuelve Pub/Sub y el envio
 * queda Enviado; si falla y es reintentable sigue Pendiente (el proceso de reintentos lo retoma) y si no, queda en Error.
 */
async function intentarEnvio(envio) {
  const payload = envio.payload || (await repo.obtener(envio.id, { conPayload: true })).payload;
  const r = await publicar(payload, {
    tipo: "NOTA_CREDITO",
    tipo_operacion: payload.tipo_operacion,
    referencia_externa: payload.referencia_externa,
    // un reenvio con justificacion es un mensaje NUEVO para Contabilidad: su clave cambia en cada reenvio (r1, r2...)
    idempotency_key: `${claveIdempotencia(payload.referencia_externa)}${payload.reenvio ? `-r${payload.reenvio.numero}` : ""}`,
    origen: "devoluciones",
    grupo: cfg.GRUPO_ORIGEN,
  });
  await registrarEnvio({ servicio: "devoluciones", tipo: "NOTA_CREDITO", referencia: payload.referencia_externa, topico: cfg.PUBSUB_TOPIC, origen: cfg.GRUPO_ORIGEN, payload, ok: r.ok, messageId: r.messageId, error: r.error });
  if (r.ok) return repo.marcarEnviado(envio.id, r.messageId);
  return repo.registrarFallo(envio.id, r, cfg.MAX_INTENTOS, cfg.BACKOFF_BASE_SEG);
}

/**
 * Registra y publica el envio de la nota de credito de una devolucion PROCESADA.
 * Cada nota se envia una sola vez (idempotency_key nc-{numero}): si ya existe se devuelve ese envio sin publicar de nuevo.
 * Sin CONTABILIDAD_PUBSUB_TOPIC no registra nada (desarrollo local sin credenciales).
 */
async function enviarNota(codigo) {
  if (!cfg.PUBSUB_TOPIC) return { publicado: false, motivo: "CONTABILIDAD_PUBSUB_TOPIC no esta configurado" };

  const devolucion = await devolucionService.obtenerDevolucion(codigo); // 404 si no existe
  const { rows } = await query(`SELECT id FROM devoluciones.devoluciones WHERE codigo = $1`, [devolucion.codigo]);
  const nota = await notasCreditoRepo.obtenerPorDevolucion(Number(rows[0].id));
  if (!nota) throw new AppError(`La devolución ${devolucion.codigo} está ${devolucion.estado} y todavía no tiene nota de crédito.`, 409, { codigo: devolucion.codigo });

  // Los datos del cliente son un extra del mensaje: si Facturacion no responde, la nota igual se informa.
  const factura = await facturacionProxy.obtenerFactura(devolucion.factura_numero).catch(() => ({}));
  const payload = armarMensajeNotaCredito({ nota, devolucion, factura });

  const { envio, yaExiste } = await repo.crear({ notaId: nota.id, numero: nota.numero, payload });
  if (yaExiste) return yaExiste;
  // El primer intento publica el mensaje tal como se armo (JSONB reordena las claves al guardarlo).
  return intentarEnvio({ ...envio, payload });
}

/**
 * Para al reembolsar: nunca hace fallar el reembolso. Si algo sale mal lo informa en { error } y el proceso de reintentos
 * (o "reenviar") se encarga despues.
 */
async function enviarNotaSegura(codigo) {
  try {
    return await enviarNota(codigo);
  } catch (e) {
    console.error(`[contabilidad] No se pudo enviar la nota de la devolucion ${codigo}:`, e.message);
    return { publicado: false, error: e.message };
  }
}

/**
 * TDSI-95: "Reenviar a Contabilidad" una nota cuyo envio quedo en Error: la misma fila con un nuevo ciclo de intentos y un
 * intento inmediato (si sale, queda Enviado con un NUEVO messageId). Solo se reenvian los envios en Error.
 */
/**
 * Prepara el reenvio de un envio de nota de credito (por id de envio). Si Contabilidad la RECHAZO se exige una justificacion y se agrega al
 * mensaje (reenvio: { numero, justificacion, motivo_rechazo_anterior, reenviado_en }). Devuelve el envio listo para publicar, o null si no se puede.
 */
async function prepararReenvioConJustificacion(actual, justificacion) {
  const rechazado = actual.estado === "Enviado" && String(actual.resultado || "").toLowerCase() === "rechazado";
  const texto = rechazado ? String(justificacion ?? "").trim() : null;
  if (rechazado && (texto.length < 10 || texto.length > 400)) throw new AppError("Cuéntale a Contabilidad cómo se resolvió el rechazo (entre 10 y 400 caracteres).", 400, { codigo: actual.devolucion_codigo });
  const envio = await repo.prepararReenvio(actual.id);
  if (!envio || !rechazado) return envio;
  const payload = {
    ...(actual.payload || {}),
    reenvio: { numero: (actual.payload?.reenvio?.numero || 0) + 1, justificacion: texto, motivo_rechazo_anterior: actual.resultado_motivo ?? null, reenviado_en: new Date().toISOString() },
  };
  await repo.actualizarPayload(envio.id, payload);
  return { ...envio, payload };
}

async function reenviarNota(codigo, { justificacion } = {}) {
  const actual = await repo.obtenerPorDevolucionCodigo(codigo, { conPayload: true });
  if (!actual) {
    const devolucion = await devolucionService.obtenerDevolucion(codigo); // 404 si la devolucion no existe
    throw new AppError(`La devolución ${devolucion.codigo} no tiene un envío a Contabilidad (solo las PROCESADAS con nota de crédito).`, 404, { codigo: devolucion.codigo });
  }
  const envio = await prepararReenvioConJustificacion(actual, justificacion);
  if (!envio) {
    throw new AppError(`Solo se pueden reenviar los envíos con estado Error o rechazados por Contabilidad (este está ${actual.estado}).`, 409, { codigo: actual.devolucion_codigo, estado: actual.estado });
  }
  return intentarEnvio(envio);
}

module.exports = { enviarNota, enviarNotaSegura, intentarEnvio, reenviarNota, prepararReenvioConJustificacion };
