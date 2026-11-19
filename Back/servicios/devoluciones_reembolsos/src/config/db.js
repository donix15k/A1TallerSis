require("dotenv").config();
const { Pool } = require("pg");

// Conexion a Supabase por el pooler (no la "Direct connection": esa es IPv6 y falla desde Docker).
// Todo este servicio vive en el schema "devoluciones": las consultas lo nombran siempre
// explicito (devoluciones.devoluciones, devoluciones.motivos, ...) porque el pooler en modo
// transaccion no conserva un "SET search_path" entre consultas.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on("error", (err) => console.error("Error inesperado en PostgreSQL:", err));

const query = (text, params) => pool.query(text, params);

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await fn(client);
    await client.query("COMMIT");
    return resultado;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Verifica la conexion y que el schema "devoluciones" ya este creado (ver sql/script_devoluciones.sql). */
async function verificarEsquema() {
  const { rows } = await query(
    `SELECT count(*)::int AS tablas FROM information_schema.tables WHERE table_schema = 'devoluciones'`
  );
  return { tablas: rows[0].tablas };
}

module.exports = { pool, query, withTransaction, verificarEsquema };
