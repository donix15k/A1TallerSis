// Puente HTTP hacia Gestion de Pagos, donde viven las ventas online del Marketplace (nunca SQL cruzado entre servicios).
const { AppError } = require("../utils/AppError");

const urlPagos = () => process.env.GESTION_PAGOS_URL || "http://localhost:4005";
const timeoutMs = () => Number(process.env.PAGOS_TIMEOUT_MS) || 5000;

/**
 * TDSI-114: consulta una orden online por su numero: { orden_id, estado, total, metodo_pago, numero_factura,
 * factura_emitida, items }. 404 si no existe; Gestion de Pagos caida o lenta -> 503 (error pasajero: la solicitud se
 * reintenta en la siguiente lectura en vez de descartarse).
 */
async function obtenerOrden(ordenId) {
  let respuesta;
  try {
    respuesta = await fetch(`${urlPagos()}/api/pagos/online/orden/${encodeURIComponent(ordenId)}`, { signal: AbortSignal.timeout(timeoutMs()) });
  } catch (e) {
    const lenta = e.name === "TimeoutError" || e.name === "AbortError";
    throw new AppError(lenta ? "Gestión de Pagos no respondió a tiempo al consultar la orden." : "No se pudo conectar con Gestión de Pagos para consultar la orden.", 503, { causa: e.message });
  }
  const cuerpo = await respuesta.json().catch(() => null);
  if (respuesta.status === 200 && cuerpo?.data) return cuerpo.data;
  if (respuesta.status === 404) throw new AppError(`La orden ${ordenId} no existe en las ventas online.`, 404, { orden_id: ordenId });
  if (respuesta.status === 400) throw new AppError(cuerpo?.mensaje || "El número de orden no es válido.", 400, { orden_id: ordenId });
  throw new AppError("Gestión de Pagos devolvió una respuesta inesperada al consultar la orden.", 502, { status: respuesta.status });
}

module.exports = { obtenerOrden };
