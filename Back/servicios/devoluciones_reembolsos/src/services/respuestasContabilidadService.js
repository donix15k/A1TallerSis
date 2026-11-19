const repo = require("../data/enviosContabilidadRepo");

// referencia_externa de nuestros envios: el numero de la nota de credito, "NC-000001"
const REFERENCIA = /^NC-\d+$/;

/**
 * TDSI-94: interpreta un mensaje del topico del Grupo A1. Devuelve null si no es una respuesta de Contabilidad
 * (resultado_documento) a una NOTA DE CREDITO nuestra: las respuestas a facturas, diferencias de caja, etc. las leen
 * otros servicios de la misma suscripcion.
 *   { referencia, notaNumero, resultado ("registrado" | "rechazado" | ...), numeroAsiento, motivo }
 */
function interpretar(texto) {
  let r;
  try {
    r = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!r || r.sistema_origen !== "CONTABILIDAD" || r.tipo_mensaje !== "resultado_documento") return null;
  const referencia = String(r.referencia_externa || "").trim();
  if (!REFERENCIA.test(referencia) || !r.estado) return null;
  return {
    referencia,
    notaNumero: referencia,
    resultado: String(r.estado).trim().toLowerCase().slice(0, 20),
    numeroAsiento: r.numero_asiento != null ? String(r.numero_asiento).slice(0, 30) : null,
    motivo: r.motivo ? String(r.motivo).slice(0, 400) : null,
  };
}

/**
 * Guarda el resultado (N° de asiento o motivo del rechazo) en el envio de esa nota. propio = true solo si el mensaje
 * corresponde a una nota nuestra con envio registrado: esos se confirman (ack); el resto se libera para quien mas lea.
 */
async function procesarMensaje({ texto, messageId }) {
  const datos = interpretar(texto);
  if (!datos) return { propio: false };
  const envio = await repo.registrarResultado({ ...datos, messageId });
  return { propio: Boolean(envio), referencia: datos.referencia, resultado: datos.resultado, envio };
}

module.exports = { interpretar, procesarMensaje };
