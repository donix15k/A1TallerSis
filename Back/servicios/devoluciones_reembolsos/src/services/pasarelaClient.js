// Puente hacia la pasarela de pagos que revierte cobros con tarjeta o QR.
// Con PASARELA_URL definido llama a POST {PASARELA_URL}/reversiones; sin PASARELA_URL la pasarela es SIMULADA
// (acepta todo): en el taller no hay una pasarela real, pero el flujo de envio y reintentos es el mismo.
const { AppError } = require("../utils/AppError");

const timeoutMs = () => Number(process.env.PASARELA_TIMEOUT_MS) || 5000;

/**
 * Pide a la pasarela revertir `monto` del cobro de la devolucion. Resuelve si la pasarela lo acepta (2xx);
 * lanza AppError si no responde, responde con error o rechaza (el servicio de reversiones lo reintenta).
 */
async function enviarReversion({ tipo, monto, codigo, reembolsoId }) {
  const url = process.env.PASARELA_URL;
  if (!url) return { simulada: true };

  let respuesta;
  try {
    respuesta = await fetch(`${url.replace(/\/$/, "")}/reversiones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, monto, referencia: codigo, reembolso_id: reembolsoId }),
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (e) {
    const sinRespuesta = e.name === "TimeoutError" || e.name === "AbortError";
    throw new AppError(sinRespuesta ? "La pasarela no respondió a tiempo" : "No se pudo conectar con la pasarela", 503, { causa: e.message });
  }
  if (!respuesta.ok) throw new AppError(`La pasarela rechazó la reversión (HTTP ${respuesta.status})`, 502, { status: respuesta.status });
  return { simulada: false };
}

module.exports = { enviarReversion };
