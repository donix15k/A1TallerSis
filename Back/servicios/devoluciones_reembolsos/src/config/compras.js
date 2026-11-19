// TDSI-104: aviso de productos devueltos al area de Compras (Grupo C) por Google Pub/Sub, en su topico
// (ucb-sis323-sub-c). Sin COMPRAS_PUBSUB_TOPIC no se publica nada (desarrollo local, o integracion aun apagada).
// Las credenciales de la cuenta de servicio son las mismas de Contabilidad (GOOGLE_CREDENTIALS_JSON).
require("dotenv").config(); // la configuracion se lee al cargar este modulo: el .env tiene que estar ya cargado

function topico(nombre) {
  const v = String(process.env[nombre] || "").trim();
  if (v && !/^(projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/)?[A-Za-z][\w.~+%-]{2,254}$/.test(v))
    throw new Error(`${nombre} debe tener la forma projects/<proyecto>/topics/<topico>`);
  return v || null;
}

const contabilidad = require("./contabilidad");

module.exports = {
  PUBSUB_TOPIC: topico("COMPRAS_PUBSUB_TOPIC"),
  // Mismo criterio de reintentos y de grupo de origen que Contabilidad.
  GRUPO_ORIGEN: contabilidad.GRUPO_ORIGEN,
  MAX_INTENTOS: contabilidad.MAX_INTENTOS,
  BACKOFF_BASE_SEG: contabilidad.BACKOFF_BASE_SEG,
  // TDSI-105: el acuse de Compras llega a nuestra suscripcion (la misma donde responde Contabilidad).
  ACUSES_SUBSCRIPTION: String(process.env.COMPRAS_ACUSES_SUBSCRIPTION || "").trim() || contabilidad.RESPUESTAS_SUBSCRIPTION,
};
