// Publica en el topico de COMPRAS (Grupo C, ucb-sis323-sub-c) la confirmacion de que se pago a un proveedor. Es un cliente NUEVO e independiente: no usa ni cambia
// el publicador del reporte a Contabilidad (pubsubPublisher.js). Mismas credenciales (GOOGLE_CREDENTIALS_JSON) y mismo criterio de errores.
const { PubSub } = require("@google-cloud/pubsub");
const cfg = require("../config/integraciones");

const NO_REINTENTABLES = new Set([3, 5, 7, 16]); // argumento invalido, topico inexistente, sin permiso, sin autenticacion
const VARIABLE = "COMPRAS_PAGO_PUBSUB_TOPIC";

let cliente = null;
const topicos = new Map();

// Solo para pruebas: fija el topico (las pruebas automaticas NO leen el del .env, para no publicar nada real).
let topicoPrueba;
function usarTopicoDePrueba(t) {
  topicoPrueba = t;
}
function topicoConfigurado() {
  if (topicoPrueba !== undefined) return topicoPrueba;
  if (process.env.NODE_TEST_CONTEXT) return null;
  const v = String(process.env[VARIABLE] || "").trim();
  if (v && !/^(projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/)?[A-Za-z][\w.~+%-]{2,254}$/.test(v)) throw new Error(`${VARIABLE} debe tener la forma projects/<proyecto>/topics/<topico>`);
  return v || null;
}

function crearCliente() {
  const cred = cfg.GOOGLE_CREDENTIALS;
  if (!cred) return new PubSub();
  return new PubSub({ projectId: cred.project_id, credentials: { client_email: cred.client_email, private_key: cred.private_key } });
}

function conTiempoLimite(promesa, ms) {
  let timer;
  const limite = new Promise((_, rechazar) => {
    timer = setTimeout(() => rechazar(Object.assign(new Error(`Pub/Sub no respondio en ${ms} ms`), { tiempoAgotado: true })), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(timer));
}

/** Publica `mensaje` como JSON. Devuelve { ok: true, messageId, topico } | { ok: false, reintentable, error, topico }. */
async function publicarEnCompras(mensaje, atributos = {}) {
  const topico = topicoConfigurado();
  if (!topico) return { ok: false, reintentable: false, topico: null, error: `${VARIABLE} no esta configurado` };
  const attributes = Object.fromEntries(Object.entries(atributos).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)]));
  try {
    if (!cliente) cliente = crearCliente();
    if (!topicos.has(topico)) topicos.set(topico, cliente.topic(topico, { batching: { maxMessages: 1, maxMilliseconds: 0 } }));
    const messageId = await conTiempoLimite(topicos.get(topico).publishMessage({ json: mensaje, attributes }), cfg.PUBSUB_TIMEOUT_MS);
    return { ok: true, messageId, topico };
  } catch (e) {
    const reintentable = e.tiempoAgotado || !NO_REINTENTABLES.has(e.code);
    return { ok: false, reintentable, topico, error: `Pub/Sub: ${e.message}`.slice(0, 400) };
  }
}

/** Solo para pruebas: reemplaza el cliente real por uno simulado (null vuelve al real). */
function usarClienteDePrueba(falso) {
  cliente = falso;
  topicos.clear();
}

module.exports = { publicarEnCompras, usarClienteDePrueba, usarTopicoDePrueba };
