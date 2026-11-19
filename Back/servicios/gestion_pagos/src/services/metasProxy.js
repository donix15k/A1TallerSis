// Puente HTTP hacia Gestion de Caja, donde viven las metas de venta diarias de cada caja (nunca SQL cruzado entre servicios).
const urlCaja = () => process.env.GESTION_CAJA_URL || "http://localhost:4004";
const timeoutMs = () => Number(process.env.CAJA_TIMEOUT_MS) || 5000;

/**
 * TDSI-139: la meta diaria total (suma de las cajas activas con meta). Si Caja no responde o no hay metas cargadas, la meta es
 * null y el grafico se muestra igual, sin la linea roja: la serie de ventas no depende de que Caja este arriba.
 * Devuelve { meta_diaria, cajas_con_meta, error }.
 */
async function obtenerMetaDiaria() {
  try {
    const r = await fetch(`${urlCaja()}/api/metas/resumen`, { signal: AbortSignal.timeout(timeoutMs()) });
    const cuerpo = await r.json().catch(() => null);
    if (r.status !== 200 || !cuerpo?.data) return { meta_diaria: null, cajas_con_meta: 0, error: cuerpo?.mensaje || `Gestión de Caja respondió HTTP ${r.status}` };
    return { meta_diaria: cuerpo.data.meta_diaria_total ?? null, cajas_con_meta: cuerpo.data.cajas_con_meta ?? 0, error: null };
  } catch (e) {
    const lenta = e.name === "TimeoutError" || e.name === "AbortError";
    return { meta_diaria: null, cajas_con_meta: 0, error: lenta ? "Gestión de Caja no respondió a tiempo" : "No se pudo conectar con Gestión de Caja" };
  }
}

module.exports = { obtenerMetaDiaria };
