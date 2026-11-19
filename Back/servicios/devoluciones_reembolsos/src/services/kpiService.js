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

/**
 * TDSI-180: los asientos de NOTAS DE CREDITO que se avisaron a Contabilidad en el periodo (hora de Bolivia, por la fecha de envio),
 * para el KPI 6 · Aceptacion contable que arma Facturacion:
 *   { periodo, desde, hasta, enviados, registrados, rechazados, sin_respuesta, rechazados_lista: [{ id, referencia, tipo, motivo, enviado_en }] }
 * registrados = Contabilidad contesto "registrado" (o "aceptado"); rechazados = contesto "rechazado" (con su motivo); sin_respuesta =
 * enviados que todavia no tienen respuesta (NO cuentan como rechazados).
 */
async function asientosContablesDelPeriodo({ periodo, ahora } = {}) {
  const rango = rangoDelPeriodo(periodo, { ahora });
  const { rows } = await query(
    `SELECT e.id, n.numero, e.resultado, e.resultado_motivo, e.enviado_en
       FROM devoluciones.envios_contabilidad_nc e
       JOIN devoluciones.notas_credito n ON n.id = e.nota_credito_id
      WHERE e.estado = 'Enviado' AND e.enviado_en IS NOT NULL
        AND (e.enviado_en AT TIME ZONE 'America/La_Paz')::date BETWEEN $1::date AND $2::date
      ORDER BY e.enviado_en DESC, e.id DESC`,
    [rango.desde, rango.hasta]
  );
  const resultado = (r) => String(r.resultado ?? "").trim().toLowerCase();
  const registrados = rows.filter((r) => ["registrado", "aceptado"].includes(resultado(r))).length;
  const rechazadas = rows.filter((r) => resultado(r) === "rechazado");
  return {
    ...rango,
    enviados: rows.length,
    registrados,
    rechazados: rechazadas.length,
    sin_respuesta: rows.length - registrados - rechazadas.length,
    rechazados_lista: rechazadas.map((r) => ({ id: String(r.id), referencia: r.numero, tipo: "NOTA_CREDITO", motivo: r.resultado_motivo || "Sin motivo informado", enviado_en: r.enviado_en })),
  };
}

module.exports = { devolucionesDelPeriodo, asientosContablesDelPeriodo };
