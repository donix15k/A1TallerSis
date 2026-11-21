// "Espejo" de un topico: Pub/Sub no deja leer un topico, solo las SUSCRIPCIONES de ese topico. La cuenta de servicio de A1 puede publicar en los
// topicos de todos los grupos y crear suscripciones sobre ellos (permiso attachSubscription), asi que, SOLO cuando el administrador lo pide, se
// crea una suscripcion PROPIA de A1 sobre el topico elegido. Es una copia independiente: no le quita ni le retrasa nada a la suscripcion del otro
// grupo. Para no acumular mensajes (la suscripcion nunca se queda "cargada"): retencion minima de 10 minutos, se vacia (ack) al leerla y caduca
// sola tras 1 dia sin uso. Solo ve lo que se publique DESPUES de activarla (los mensajes anteriores no se pueden recuperar).
const { PubSub } = require("@google-cloud/pubsub");
const subscriber = require("../clients/pubsubSubscriber");
const cfg = require("../config/marketplace");
const { GRUPOS, buscarPorGrupo } = require("../config/pubsubGrupos");
const { AppError } = require("../utils/AppError");

const PREFIJO = "ucb-sis323-a1-espejo-";
const RETENCION_SEG = 600; // el minimo que permite Pub/Sub (10 min)
const CADUCA_SEG = 86400; // el minimo de expirationPolicy (1 dia)
const MAX_LECTURA = 20;

let cliente = null;
function obtenerCliente() {
  if (!cliente) {
    const c = cfg.GOOGLE_CREDENTIALS;
    cliente = new PubSub(c ? { projectId: c.project_id, credentials: { client_email: c.client_email, private_key: c.private_key } } : {});
  }
  return cliente;
}

function grupoValido(grupo) {
  const g = buscarPorGrupo(grupo);
  if (!g) throw new AppError(`El grupo debe ser uno de: ${GRUPOS.map((x) => x.grupo).join(", ")}.`, 400, { grupo });
  return g;
}
const nombreEspejo = (g) => `${PREFIJO}${g.sufijo.replace(/^sub-/, "")}`;
const nombreCompleto = (g) => subscriber.nombreSuscripcion(nombreEspejo(g));
const sinPermiso = (e) => e.code === 7 || /permission|not authorized|PERMISSION_DENIED/i.test(e.message || "");
const noExiste = (e) => e.code === 5 || /NOT_FOUND|not found/i.test(e.message || "");

/** Crea (o confirma) el espejo de A1 sobre el topico del grupo. */
async function activar(grupo) {
  const g = grupoValido(grupo);
  try {
    await obtenerCliente().topic(g.topico).createSubscription(nombreEspejo(g), {
      ackDeadlineSeconds: 10,
      messageRetentionDuration: { seconds: RETENCION_SEG },
      expirationPolicy: { ttl: { seconds: CADUCA_SEG } },
    });
    return { grupo: g.grupo, topico: g.topico, suscripcion: nombreEspejo(g), activo: true, nuevo: true, retencion_min: RETENCION_SEG / 60 };
  } catch (e) {
    if (e.code === 6 || /ALREADY_EXISTS/i.test(e.message)) return { grupo: g.grupo, topico: g.topico, suscripcion: nombreEspejo(g), activo: true, nuevo: false, retencion_min: RETENCION_SEG / 60 };
    if (sinPermiso(e)) throw new AppError(`La cuenta de servicio de A1 no tiene permiso para crear una suscripción sobre el tópico del grupo ${g.grupo}. Hay que pedirle al dueño del proyecto el rol de Pub/Sub Editor.`, 403, { grupo: g.grupo });
    throw new AppError(`No se pudo crear el espejo: ${String(e.message).slice(0, 200)}`, 502, { grupo: g.grupo });
  }
}

/**
 * Lee (y vacia) lo que llego al topico desde que se activo el espejo: hasta 20 mensajes por vez. Si no hay espejo activo responde
 * { activo: false } (no es un error).
 */
async function leer(grupo) {
  const g = grupoValido(grupo);
  try {
    const mensajes = await subscriber.leer(MAX_LECTURA, nombreCompleto(g));
    await subscriber.confirmar(mensajes.map((m) => m.ackId), nombreCompleto(g));
    return {
      grupo: g.grupo,
      topico: g.topico,
      activo: true,
      mensajes: mensajes.map((m) => {
        let json = null;
        try { json = JSON.parse(m.texto); } catch { /* texto libre */ }
        return { message_id: m.messageId, publicado_en: m.publicadoEn, atributos: m.atributos, texto: m.texto, json };
      }),
    };
  } catch (e) {
    if (noExiste(e)) return { grupo: g.grupo, topico: g.topico, activo: false, mensajes: [] };
    if (sinPermiso(e)) throw new AppError(`No hay permiso para leer el espejo del grupo ${g.grupo}.`, 403, { grupo: g.grupo });
    throw new AppError(`No se pudo leer el espejo: ${String(e.message).slice(0, 200)}`, 502, { grupo: g.grupo });
  }
}

/** Borra el espejo (deja el proyecto como estaba). */
async function desactivar(grupo) {
  const g = grupoValido(grupo);
  try {
    await obtenerCliente().subscription(nombreEspejo(g)).delete();
    return { grupo: g.grupo, activo: false, eliminado: true };
  } catch (e) {
    if (noExiste(e)) return { grupo: g.grupo, activo: false, eliminado: false };
    if (sinPermiso(e)) throw new AppError(`No hay permiso para borrar el espejo del grupo ${g.grupo}.`, 403, { grupo: g.grupo });
    throw new AppError(`No se pudo borrar el espejo: ${String(e.message).slice(0, 200)}`, 502, { grupo: g.grupo });
  }
}

/** Solo para pruebas. */
function usarClienteDePrueba(falso) {
  cliente = falso;
}

module.exports = { activar, leer, desactivar, nombreEspejo, usarClienteDePrueba, RETENCION_SEG, CADUCA_SEG, MAX_LECTURA };
