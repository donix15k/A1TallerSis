const { query } = require("../config/db");

/** TDSI-47/171: perfil de un cajero, ligado a su cuenta de Supabase Auth (cajero_id). "usuario" es su nombre de usuario unico; "correo" es solo informativo y "email_auth" es el correo interno de su cuenta de Supabase. */
async function crear({ cajero_id, usuario, nombre, correo = null, email_auth }) {
  const { rows } = await query(
    `INSERT INTO caja.cajeros (cajero_id, usuario, nombre, correo, email_auth) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [cajero_id, usuario, nombre, correo, email_auth ?? usuario]
  );
  return rows[0];
}

/** El usuario es unico sin distinguir mayusculas. */
async function buscarPorUsuario(usuario) {
  const { rows } = await query(`SELECT * FROM caja.cajeros WHERE lower(usuario) = lower($1)`, [usuario]);
  return rows[0] || null;
}

/** TDSI-47/916: lista de cajeros para la pantalla "Usuarios". */
async function listar() {
  const { rows } = await query(`SELECT * FROM caja.cajeros ORDER BY nombre`);
  return rows;
}

async function buscarPorCajeroId(cajero_id) {
  const { rows } = await query(`SELECT * FROM caja.cajeros WHERE cajero_id = $1`, [cajero_id]);
  return rows[0] || null;
}

/** TDSI-47/917: "Editar" -- cambia nombre, usuario y correo informativo. */
async function actualizar(cajero_id, { usuario, nombre, correo = null }) {
  const { rows } = await query(
    `UPDATE caja.cajeros SET usuario = $2, nombre = $3, correo = $4 WHERE cajero_id = $1 RETURNING *`,
    [cajero_id, usuario, nombre, correo]
  );
  return rows[0] || null;
}

/** TDSI-47/918: "Activar" / "Desactivar" -- un cajero desactivado no puede iniciar sesion. */
async function cambiarEstado(cajero_id, activo) {
  const { rows } = await query(
    `UPDATE caja.cajeros SET activo = $2 WHERE cajero_id = $1 RETURNING *`,
    [cajero_id, activo]
  );
  return rows[0] || null;
}

module.exports = { crear, buscarPorUsuario, listar, buscarPorCajeroId, actualizar, cambiarEstado };
