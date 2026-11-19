const { query } = require("../config/db");
const { ZONA } = require("../utils/fechas");
const { rangoDelPeriodo } = require("../utils/periodo");

/**
 * TDSI-180: los asientos de DIFERENCIAS DE CAJA que se avisaron a Contabilidad en el periodo (hora de Bolivia, por la fecha de
 * envio), para el KPI 6 · Aceptacion contable que arma Facturacion:
 *   { periodo, desde, hasta, enviados, registrados, rechazados, sin_respuesta, rechazados_lista: [{ id, referencia, tipo, motivo, enviado_en }] }
 * registrados = Contabilidad la confirmo; rechazados = la rechazo (con su motivo); sin_respuesta = enviados que todavia no tienen
 * respuesta (NO cuentan como rechazados). Un envio que sigue Pendiente (nunca salio) no cuenta como enviado.
 */
async function asientosContablesDelPeriodo({ periodo, hoy } = {}) {
  const rango = rangoDelPeriodo(periodo, { hoy });
  const { rows } = await query(
    `SELECT e.diferencia_id, e.estado, e.motivo_rechazo, e.enviado_en
       FROM caja.diferencias_envios_contabilidad e
      WHERE e.estado IN ('Enviado', 'Confirmado', 'Rechazado') AND e.enviado_en IS NOT NULL
        AND (e.enviado_en AT TIME ZONE '${ZONA}')::date BETWEEN $1::date AND $2::date
      ORDER BY e.enviado_en DESC, e.id DESC`,
    [rango.desde, rango.hasta]
  );
  const registrados = rows.filter((r) => r.estado === "Confirmado").length;
  const rechazadas = rows.filter((r) => r.estado === "Rechazado");
  return {
    ...rango,
    enviados: rows.length,
    registrados,
    rechazados: rechazadas.length,
    sin_respuesta: rows.length - registrados - rechazadas.length,
    rechazados_lista: rechazadas.map((r) => ({ id: String(r.diferencia_id), referencia: `DIF-${r.diferencia_id}`, tipo: "DIFERENCIA_CAJA", motivo: r.motivo_rechazo || "Sin motivo informado", enviado_en: r.enviado_en })),
  };
}

module.exports = { asientosContablesDelPeriodo };
