// Las devoluciones que se reembolsaron durante el turno viven en Devoluciones (dueño de esos datos): Caja solo las consulta para el reporte de cierre.
const DEVOLUCIONES_URL = process.env.DEVOLUCIONES_URL || "http://localhost:4007";

/**
 * [{ codigo, factura_numero, procesada_en, monto_total, productos: [{descripcion, cantidad, subtotal}], reembolsos: [{forma, monto}] }].
 * Si Devoluciones no responde devuelve null (el reporte lo avisa; nunca impide cerrar la caja).
 */
async function obtenerDevolucionesDelTurno({ cajeros, desde, hasta }) {
  const params = new URLSearchParams({ cajeros: cajeros.join(","), desde: new Date(desde).toISOString() });
  if (hasta) params.set("hasta", new Date(hasta).toISOString());
  try {
    const respuesta = await fetch(`${DEVOLUCIONES_URL}/api/devoluciones/del-turno?${params.toString()}`, { signal: AbortSignal.timeout(6000) });
    const datos = await respuesta.json().catch(() => null);
    if (!respuesta.ok || !Array.isArray(datos?.data)) return null;
    return datos.data;
  } catch {
    return null;
  }
}

module.exports = { obtenerDevolucionesDelTurno };
