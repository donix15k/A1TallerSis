const { query } = require("../config/db");

const num = (v) => (v === null || v === undefined ? v : Number(v));
const normalizar = (r) => (r ? { ...r, monto_mensual: num(r.monto_mensual) } : null);

/**
 * TDSI-161: la meta MENSUAL de cada caja (las filas "Meta Caja N" de "Configurar objetivos"). Una caja tiene a lo sumo una meta
 * mensual vigente (UNIQUE sobre caja_id); guardarla de nuevo la reemplaza.
 */
async function listarTodas() {
  const { rows } = await query(`SELECT * FROM caja.metas_mensuales`);
  return rows.map(normalizar);
}

async function guardarMeta(cajaId, { montoMensual, actualizadoPor }) {
  const { rows } = await query(
    `INSERT INTO caja.metas_mensuales (caja_id, monto_mensual, actualizado_por)
     VALUES ($1, $2, $3)
     ON CONFLICT (caja_id) DO UPDATE
       SET monto_mensual = EXCLUDED.monto_mensual, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()
     RETURNING *`,
    [cajaId, montoMensual, actualizadoPor || null]
  );
  return normalizar(rows[0]);
}

module.exports = { listarTodas, guardarMeta };
