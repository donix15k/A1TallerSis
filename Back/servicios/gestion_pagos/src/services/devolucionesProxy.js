// Puente HTTP hacia el microservicio de Devoluciones (nunca SQL cruzado entre servicios).
const urlDevoluciones = () => process.env.DEVOLUCIONES_URL || "http://localhost:4007";
const timeoutMs = () => Number(process.env.DEVOLUCIONES_TIMEOUT_MS) || 5000;

/**
 * TDSI-150: el monto devuelto del periodo y el % por motivo (GET /api/kpis/devoluciones de Devoluciones, solo administrador: se le
 * reenvia el token). Si Devoluciones no responde NO se cae el Panel de KPIs: devuelve { datos: null, error }.
 */
async function obtenerDevolucionesDelPeriodo({ periodo, token }) {
  try {
    const r = await fetch(`${urlDevoluciones()}/api/kpis/devoluciones?periodo=${encodeURIComponent(periodo)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(timeoutMs()),
    });
    const cuerpo = await r.json().catch(() => null);
    if (r.status !== 200 || !cuerpo?.data) return { datos: null, error: cuerpo?.mensaje || `Devoluciones respondió HTTP ${r.status}` };
    return { datos: cuerpo.data, error: null };
  } catch (e) {
    const lenta = e.name === "TimeoutError" || e.name === "AbortError";
    return { datos: null, error: lenta ? "Devoluciones no respondió a tiempo" : "No se pudo conectar con Devoluciones" };
  }
}

module.exports = { obtenerDevolucionesDelPeriodo };
