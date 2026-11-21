// TDSI-92: envio de las notas de credito a Contabilidad (Grupo D) por Pub/Sub, de forma asincrona: se publica y no se
// espera; Contabilidad responde despues en nuestra suscripcion (TDSI-94).
const repo = require("../data/enviosContabilidadRepo");
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
    idempotency_key: claveIdempotencia(payload.referencia_externa),
    origen: "devoluciones",
    grupo: cfg.GRUPO_ORIGEN,
  });
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
async function reenviarNota(codigo) {
  const actual = await repo.obtenerPorDevolucionCodigo(codigo);
  if (!actual) {
    const devolucion = await devolucionService.obtenerDevolucion(codigo); // 404 si la devolucion no existe
    throw new AppError(`La devolución ${devolucion.codigo} no tiene un envío a Contabilidad (solo las PROCESADAS con nota de crédito).`, 404, { codigo: devolucion.codigo });
  }
  const envio = await repo.prepararReenvio(actual.id);
  if (!envio) {
    throw new AppError(`Solo se pueden reenviar los envíos con estado Error o rechazados por Contabilidad (este está ${actual.estado}).`, 409, { codigo: actual.devolucion_codigo, estado: actual.estado });
  }
  return intentarEnvio(envio);
}

module.exports = { enviarNota, enviarNotaSegura, intentarEnvio, reenviarNota };
