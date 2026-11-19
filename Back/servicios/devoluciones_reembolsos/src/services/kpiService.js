// TDSI-149: KPIs de devoluciones para el Panel de KPIs del administrador. Fechas en hora de Bolivia. Solo cuentan las devoluciones
// PROCESADAS (ya reembolsadas), en el mes en que se procesaron.
const { query } = require("../config/db");
const { rangoDelPeriodo } = require("../utils/periodo");

const centavos = (n) => Math.round(Number(n) * 100);
const aMonto = (c) => Math.round(c) / 100;
const porcentaje = (parte, total) => (total > 0 ? Math.round((parte / total) * 10000) / 100 : 0);

/**
 * El monto devuelto del periodo y el reparto por motivo, de mayor a menor monto:
 *   { periodo, desde, hasta, monto_devuelto, cantidad, motivos: [{ motivo_id, motivo, cantidad, monto, porcentaje }] }
 * porcentaje = monto del motivo / monto devuelto x 100. Sin devoluciones: monto 0 y lista vacia.
 */
async function devolucionesDelPeriodo({ periodo, ahora } = {}) {
  const rango = rangoDelPeriodo(periodo, { ahora });
  const { rows } = await query(
    `SELECT m.id AS motivo_id, COALESCE(m.nombre, 'Sin motivo') AS motivo, COUNT(*)::int AS cantidad, SUM(d.monto_total)::text AS monto
       FROM devoluciones.devoluciones d
       LEFT JOIN devoluciones.motivos m ON m.id = d.motivo_id
      WHERE d.estado = 'PROCESADA'
        AND EXISTS (
          SELECT 1 FROM devoluciones.historial_estados h
           WHERE h.devolucion_id = d.id AND h.estado_nuevo = 'PROCESADA'
             AND (h.cambiado_en AT TIME ZONE 'America/La_Paz')::date BETWEEN $1::date AND $2::date
        )
      GROUP BY m.id, m.nombre
      ORDER BY SUM(d.monto_total) DESC, COALESCE(m.nombre, 'Sin motivo') ASC`,
    [rango.desde, rango.hasta]
  );
  const total = rows.reduce((a, r) => a + centavos(r.monto), 0);
  return {
    ...rango,
    monto_devuelto: aMonto(total),
    cantidad: rows.reduce((a, r) => a + r.cantidad, 0),
    motivos: rows.map((r) => ({ motivo_id: r.motivo_id === null ? null : Number(r.motivo_id), motivo: r.motivo, cantidad: r.cantidad, monto: aMonto(centavos(r.monto)), porcentaje: porcentaje(centavos(r.monto), total) })),
  };
}

module.exports = { devolucionesDelPeriodo };
