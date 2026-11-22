// Registro unico de TODO mensaje de Pub/Sub que entra o sale de A1 (tabla pagos.pubsub_verificaciones, la misma que muestra la pantalla
// "Verificación de Pub/Sub"): dirección (ENVIADO / RECIBIDO), qué servicio lo movió, tipo y referencia, grupo origen y grupo destino,
// tópico, messageId, resultado y fecha/hora. Registrar nunca debe romper la operación de negocio: si el log falla solo se avisa en consola.
const { query } = require("../config/db");

const PROYECTO = "project-a96e5fe1-5ba6-4698-a85";
const TOPICO_A1 = process.env.PUBSUB_TOPICO_A1 || `projects/${PROYECTO}/topics/ucb-sis323-sub-a1`;

/** "projects/<p>/topics/ucb-sis323-sub-d" -> "D" */
function grupoDeTopico(topico) {
  const m = /ucb-sis323-(?:sub-)?([a-z0-9]+)$/i.exec(String(topico || ""));
  return m ? m[1].toUpperCase() : "OTRO";
}

/** sistema_origen de un mensaje recibido -> grupo del proyecto (para saber quién lo mandó). */
function grupoDeSistemaOrigen(sistemaOrigen) {
  const s = String(sistemaOrigen || "").toUpperCase();
  if (s.startsWith("CONTABILIDAD")) return "D";
  if (s.startsWith("MARKETPLACE")) return "E";
  if (s.startsWith("GESTION_DE_COMPRAS") || s.startsWith("COMPRAS")) return "C";
  if (s.startsWith("GESTION_DE_PAGOS") || s.startsWith("FACTURACION") || s.startsWith("GESTION_CAJA")) return "A1";
  return "OTRO";
}

// Las pruebas automaticas (node --test) usan Pub/Sub FALSO: no ensucian el registro real salvo que pidan PUBSUB_LOG_EN_PRUEBAS=1.
const omitir = () => Boolean(process.env.NODE_TEST_CONTEXT) && process.env.PUBSUB_LOG_EN_PRUEBAS !== "1";

async function registrar({ direccion, servicio, tipo, referencia, origen, destino, topico, mensaje, payload, ok = true, messageId, error, por }) {
  if (omitir()) return;
  try {
    await query(
      `INSERT INTO pagos.pubsub_verificaciones
         (direccion, servicio, tipo, referencia, grupo_origen, grupo, topico, mensaje, payload_enviado, ok, message_id, error, enviado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        direccion, servicio || null, tipo || null, referencia || null,
        String(origen || "A1").slice(0, 10), String(destino || "A1").slice(0, 10), String(topico || "").slice(0, 200),
        String(mensaje || `${tipo || "mensaje"} ${referencia || ""}`).trim().slice(0, 2000),
        payload === undefined ? null : JSON.stringify(payload), Boolean(ok), messageId || null, error ? String(error).slice(0, 500) : null, por || servicio || null,
      ]
    );
  } catch (e) {
    console.error(`[pubsub-log] No se pudo registrar el mensaje ${tipo || ""} ${referencia || ""}:`, e.message);
  }
}

/** Un mensaje que A1 publicó (destino = grupo dueño del tópico). */
const registrarEnvio = ({ origen = "A1", ...r }) => registrar({ direccion: "ENVIADO", origen, destino: grupoDeTopico(r.topico), ...r });

/** Un mensaje que A1 leyó de su suscripción y que le correspondía procesar (el tópico es el de A1). */
const registrarRecepcion = (r) => registrar({ direccion: "RECIBIDO", destino: "A1", topico: TOPICO_A1, ...r });

/** El cuerpo de un mensaje recibido como objeto (o null si no es JSON). */
function parsear(texto) {
  try { return JSON.parse(texto); } catch { return null; }
}

module.exports = { registrarEnvio, registrarRecepcion, grupoDeTopico, grupoDeSistemaOrigen, parsear, TOPICO_A1 };
