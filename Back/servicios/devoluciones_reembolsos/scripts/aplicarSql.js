// Aplica sql/script_devoluciones.sql en la base indicada por DATABASE_URL.
// El script es idempotente (CREATE ... IF NOT EXISTS / ON CONFLICT DO NOTHING): se puede
// correr las veces que haga falta sin duplicar ni borrar nada.   Uso:  npm run db:schema
const fs = require("fs");
const path = require("path");
const { pool, verificarEsquema, query } = require("../src/config/db");

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "sql", "script_devoluciones.sql"), "utf8");
  await pool.query(sql);
  const { tablas } = await verificarEsquema();
  const { rows } = await query("SELECT count(*)::int AS n FROM devoluciones.motivos");
  console.log(`Schema "devoluciones" listo: ${tablas} tablas, ${rows[0].n} motivos.`);
  await pool.end();
})().catch(async (e) => {
  console.error("No se pudo aplicar el script:", e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
