// TDSI-104: aviso de productos devueltos a Compras (Grupo C) por Pub/Sub, de forma asincrona: se publica en
// ucb-sis323-sub-c y no se espera; el acuse de Compras llega despues a nuestra suscripcion (TDSI-105).
const repo = require("../data/enviosComprasRepo");
const { registrarEnvio } = require("../utils/pubsubLog");
const { publicar } = require("../clients/pubsubPublisher");
const cfg = require("../config/compras");
const { armarMensajeProductosDevueltos } = require("./comprasMensaje");
const devolucionService = require("./devolucionService");
const { query } = require("../config/db");
const { AppError } = require("../utils/AppError");

/**
 * Un intento de publicacion; deja registrado el resultado. Con exito guarda el messageId que devuelve Pub/Sub y el aviso
 * queda Enviado; si falla y es reintentable sigue Pendiente (el proceso de reintentos lo retoma) y si no, queda en Error.
 * idempotency_key = codigo de la devolucion: aunque se reintente, Compras recibe un solo aviso.
 */
async function intentarEnvio(envio) {
  const payload = envio.payload || (await repo.obtener(envio.id, { conPayload: true })).payload;
  const r = await publicar(
    payload,
    {
      tipo: "PRODUCTOS_DEVUELTOS",
      tipo_operacion: payload.tipo_operacion,
      referencia_externa: payload.referencia_externa,
      idempotency_key: payload.referencia_externa,
      origen: "devoluciones",
      grupo: cfg.GRUPO_ORIGEN,
    },
    { topico: cfg.PUBSUB_TOPIC, variable: "COMPRAS_PUBSUB_TOPIC" }
  );
  await registrarEnvio({ servicio: "devoluciones", tipo: "PRODUCTOS_DEVUELTOS", referencia: payload.referencia_externa, topico: cfg.PUBSUB_TOPIC, origen: cfg.GRUPO_ORIGEN, payload, ok: r.ok, messageId: r.messageId, error: r.error });
  if (r.ok) return repo.marcarEnviado(envio.id, r.messageId);
  return repo.registrarFallo(envio.id, r, cfg.MAX_INTENTOS, cfg.BACKOFF_BASE_SEG);
}

/**
 * Registra y publica el aviso de una devolucion PROCESADA. Cada devolucion se avisa una sola vez (idempotency_key =
 * codigo): si ya existe se devuelve ese aviso sin publicar de nuevo. Sin COMPRAS_PUBSUB_TOPIC no registra nada.
 */
async function enviarDevolucion(codigo) {
  if (!cfg.PUBSUB_TOPIC) return { publicado: false, motivo: "COMPRAS_PUBSUB_TOPIC no esta configurado" };

  const devolucion = await devolucionService.obtenerDevolucion(codigo); // 404 si no existe
  if (devolucion.estado !== "PROCESADA") {
    throw new AppError(`La devolución ${devolucion.codigo} está ${devolucion.estado}: solo se avisa a Compras cuando queda PROCESADA.`, 409, { codigo: devolucion.codigo, estado: devolucion.estado });
  }
  const { rows } = await query(`SELECT id FROM devoluciones.devoluciones WHERE codigo = $1`, [devolucion.codigo]);
  const devolucionId = Number(rows[0].id);
  const procesada = devolucion.historial.find((h) => h.estado_nuevo === "PROCESADA");

  const payload = armarMensajeProductosDevueltos({ devolucion, procesadaEn: procesada?.cambiado_en || new Date() });
  const { envio, yaExiste } = await repo.crear({ devolucionId, codigo: devolucion.codigo, payload });
  if (yaExiste) return yaExiste;
  // El primer intento publica el mensaje tal como se armo (JSONB reordena las claves al guardarlo).
  return intentarEnvio({ ...envio, payload });
}

/** Para al reembolsar: nunca hace fallar el reembolso. Si algo sale mal lo informa en { error } y los reintentos se encargan. */
async function enviarDevolucionSegura(codigo) {
  try {
    return await enviarDevolucion(codigo);
  } catch (e) {
    console.error(`[compras] No se pudo avisar la devolucion ${codigo}:`, e.message);
    return { publicado: false, error: e.message };
  }
}

module.exports = { enviarDevolucion, enviarDevolucionSegura, intentarEnvio };
