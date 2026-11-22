// Ordenes de pago de Compras por Pub/Sub. Mensaje (mismo sobre que el resto de las integraciones):
//   { sistema_origen: "GESTION_DE_COMPRAS_Y_PROVEEDORES", tipo_operacion: "orden_pago", referencia_externa: "OP-123", fecha_documento,
//     datos: { numero, ordenCompraId, monto, proveedor: { nit, razonSocial, cuentaBancaria, banco }, fechaVencimiento, concepto } }
// Es la misma orden que Compras puede mandar por HTTP (POST /api/proveedores/compras/ordenes): se guarda con el mismo servicio.
const { recibirOrdenPago } = require("./ordenPagoService");

/** El mensaje si es una orden de pago de Compras; null si es de otro (se libera para que lo lea su dueño). */
function interpretar(texto) {
  let r;
  try {
    r = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const origen = String(r.sistema_origen || "").toUpperCase();
  if (r.tipo_operacion !== "orden_pago" || !(origen.startsWith("GESTION_DE_COMPRAS") || origen.startsWith("COMPRAS"))) return null;
  return r;
}

/**
 * Procesa un mensaje. { propio: false } si no es una orden de pago. Con orden: se guarda (estado PENDIENTE) o, si ya estaba registrada, se
 * informa como duplicada; una orden mal formada (400) tambien es "propia" (nunca se va a poder procesar) pero queda con su error.
 */
async function procesarMensaje({ texto }) {
  const r = interpretar(texto);
  if (!r) return { propio: false };
  const referencia = r.referencia_externa || r.datos?.numero || null;
  try {
    const guardada = await recibirOrdenPago(r.datos || {});
    return { propio: true, ok: true, referencia, duplicada: false, resultado: guardada, payload: r };
  } catch (e) {
    if (e.status === 409) return { propio: true, ok: true, referencia, duplicada: true, resultado: null, payload: r };
    if (e.status === 400) return { propio: true, ok: false, referencia, error: e.message, payload: r };
    throw e; // error pasajero (base de datos caida...): el job libera el mensaje para reintentarlo
  }
}

module.exports = { interpretar, procesarMensaje };
