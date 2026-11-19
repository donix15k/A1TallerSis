const { query } = require("../config/db");

/**
 * TDSI-115: guarda una solicitud del Marketplace que no se pudo registrar (mensaje mal formado, orden inexistente, fuera de
 * plazo...) con su error, para revisarla. "Si el mensaje viene mal, no se registra y se guarda el error."
 */
async function registrar({ messageId, error, payload }) {
  const { rows } = await query(
    `INSERT INTO devoluciones.marketplace_solicitudes_error (message_id, error, payload) VALUES ($1, $2, $3)
     RETURNING id, message_id, error, payload, recibido_en`,
    [messageId ? String(messageId).slice(0, 100) : null, String(error || "Error desconocido").slice(0, 500), payload === undefined || payload === null ? null : String(payload)]
  );
  return { ...rows[0], id: Number(rows[0].id) };
}

/** Las solicitudes con error, la mas reciente primero. */
async function listar({ limite = 50 } = {}) {
  const { rows } = await query(
    `SELECT id, message_id, error, payload, recibido_en FROM devoluciones.marketplace_solicitudes_error ORDER BY id DESC LIMIT $1`,
    [limite]
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

module.exports = { registrar, listar };
