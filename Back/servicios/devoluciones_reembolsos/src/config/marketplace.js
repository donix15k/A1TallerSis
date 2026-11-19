// TDSI-113/117: integracion con el Marketplace (Grupo E) por Google Pub/Sub:
//   - ellos -> nosotros: SOLICITUD_DEVOLUCION, que leemos de nuestra suscripcion (ucb-sis323-sub-a1-sub)
//   - nosotros -> ellos: DEVOLUCION_RESUELTA, que publicamos en su topico (ucb-sis323-sub-e)
// Sin las variables correspondientes no se lee ni se publica nada.
require("dotenv").config(); // la configuracion se lee al cargar este modulo: el .env tiene que estar ya cargado

function topico(nombre) {
  const v = String(process.env[nombre] || "").trim();
  if (v && !/^(projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/)?[A-Za-z][\w.~+%-]{2,254}$/.test(v))
    throw new Error(`${nombre} debe tener la forma projects/<proyecto>/topics/<topico>`);
  return v || null;
}

function entero(nombre, defecto, min, max) {
  const v = Number(process.env[nombre] ?? defecto);
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${nombre} debe ser un entero entre ${min} y ${max}`);
  return v;
}

const contabilidad = require("./contabilidad");

module.exports = {
  // Topico del Marketplace donde publicamos el resultado (ucb-sis323-sub-e)
  PUBSUB_TOPIC: topico("MARKETPLACE_PUBSUB_TOPIC"),
  GRUPO_ORIGEN: contabilidad.GRUPO_ORIGEN,
  MAX_INTENTOS: contabilidad.MAX_INTENTOS,
  BACKOFF_BASE_SEG: contabilidad.BACKOFF_BASE_SEG,
  // Nuestra suscripcion (la misma donde responden Contabilidad y Compras): de aqui salen las solicitudes de devolucion.
  SOLICITUDES_SUBSCRIPTION: String(process.env.MARKETPLACE_SOLICITUDES_SUBSCRIPTION || "").trim() || contabilidad.RESPUESTAS_SUBSCRIPTION,
  SOLICITUDES_INTERVALO_SEG: entero("MARKETPLACE_SOLICITUDES_INTERVALO_SEG", 30, 5, 3600),
};
