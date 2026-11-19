const { query } = require("../config/db");
const { ZONA } = require("../utils/fechas");

/**
 * TDSI-169: turnos CERRADOS CON ARQUEO (tienen tipo_diferencia: CUADRA, SOBRANTE o FALTANTE) cuyo cierre cae en el rango de dias
 * (AAAA-MM-DD, inclusivos, hora de Bolivia). Un turno cerrado sin arqueo no entra: no se sabe si cuadra. La diferencia viene con
 * signo (FALTANTE negativa, SOBRANTE positiva). Del mas reciente al mas antiguo.
 */
async function turnosCerradosConArqueo(desde, hasta) {
  const { rows } = await query(
    `SELECT t.id, t.codigo, t.caja_id, c.nombre AS caja_nombre, t.cajero_id, t.cajero_nombre,
            t.diferencia::text AS diferencia, t.tipo_diferencia, t.cerrado_en
       FROM caja.turnos t
       LEFT JOIN caja.cajas c ON c.codigo = t.caja_id
      WHERE t.estado = 'CERRADO'
        AND t.tipo_diferencia IS NOT NULL
        AND (t.cerrado_en AT TIME ZONE '${ZONA}')::date BETWEEN $1::date AND $2::date
      ORDER BY t.cerrado_en DESC, t.id DESC`,
    [desde, hasta]
  );
  return rows.map((r) => ({ ...r, diferencia: Number(r.diferencia ?? 0) }));
}

module.exports = { turnosCerradosConArqueo };
