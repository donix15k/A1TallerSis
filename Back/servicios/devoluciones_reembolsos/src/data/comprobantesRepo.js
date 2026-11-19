const { query } = require("../config/db");

/** TDSI-59: deja constancia de un envio de comprobante por correo (envios_comprobante). Devuelve la fila guardada. */
async function registrarEnvio({ devolucionId, email, tipo = "NOTA_CREDITO", estado }) {
  const { rows } = await query(
    `INSERT INTO devoluciones.envios_comprobante (devolucion_id, email_destino, tipo, estado, enviado_en)
     VALUES ($1, $2, $3, $4, ${estado === "ENVIADO" || estado === "SIMULADO" ? "now()" : "NULL"})
     RETURNING id, email_destino, tipo, estado, enviado_en`,
    [devolucionId, email, tipo, estado]
  );
  return { ...rows[0], id: Number(rows[0].id) };
}

/** Envios de comprobante de una devolucion, el mas reciente primero. */
async function listarEnvios(devolucionId, tipo = "NOTA_CREDITO") {
  const { rows } = await query(
    `SELECT id, email_destino, tipo, estado, enviado_en FROM devoluciones.envios_comprobante WHERE devolucion_id = $1 AND tipo = $2 ORDER BY id DESC`,
    [devolucionId, tipo]
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

module.exports = { registrarEnvio, listarEnvios };
