const { query } = require("../config/db");

const COLUMNAS = "id, cajero_id, usuario, nombre, telefono, documento, activo, creado_en";

async function buscarPorCajeroId(cajero_id) {
  const { rows } = await query(`SELECT ${COLUMNAS} FROM caja.administradores WHERE cajero_id = $1`, [cajero_id]);
  return rows[0] || null;
}

/** El correo de login es unico (sin distinguir mayusculas); los administradores creados antes de guardarlo lo tienen en null. */
async function buscarPorUsuario(usuario) {
  const { rows } = await query(`SELECT ${COLUMNAS} FROM caja.administradores WHERE lower(usuario) = lower($1)`, [usuario]);
  return rows[0] || null;
}

async function listar() {
  const { rows } = await query(`SELECT ${COLUMNAS} FROM caja.administradores ORDER BY nombre NULLS LAST, id`);
  return rows;
}

async function crear({ cajero_id, usuario, nombre, telefono = null, documento = null }) {
  const { rows } = await query(
    `INSERT INTO caja.administradores (cajero_id, usuario, nombre, telefono, documento) VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNAS}`,
    [cajero_id, usuario, nombre, telefono, documento]
  );
  return rows[0];
}

/** Datos personales: nombre, telefono y documento (el correo de login se cambia aparte porque vive tambien en Supabase Auth). */
async function actualizarPerfil(cajero_id, { nombre, telefono, documento }) {
  const { rows } = await query(
    `UPDATE caja.administradores SET nombre = $2, telefono = $3, documento = $4 WHERE cajero_id = $1 RETURNING ${COLUMNAS}`,
    [cajero_id, nombre, telefono ?? null, documento ?? null]
  );
  return rows[0] || null;
}

async function actualizarUsuario(cajero_id, usuario) {
  const { rows } = await query(`UPDATE caja.administradores SET usuario = $2 WHERE cajero_id = $1 RETURNING ${COLUMNAS}`, [cajero_id, usuario]);
  return rows[0] || null;
}

async function cambiarEstado(cajero_id, activo) {
  const { rows } = await query(`UPDATE caja.administradores SET activo = $2 WHERE cajero_id = $1 RETURNING ${COLUMNAS}`, [cajero_id, activo]);
  return rows[0] || null;
}

async function contarActivos() {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM caja.administradores WHERE activo = true`);
  return rows[0].n;
}

async function borrar(cajero_id) {
  await query(`DELETE FROM caja.administradores WHERE cajero_id = $1`, [cajero_id]);
}

module.exports = { buscarPorCajeroId, buscarPorUsuario, listar, crear, actualizarPerfil, actualizarUsuario, cambiarEstado, contarActivos, borrar };
