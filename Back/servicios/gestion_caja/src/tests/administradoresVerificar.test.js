// TDSI-82: GET /api/administradores/verificar (lo usa Devoluciones para saber si un token es de un Administrador).
// Supabase y BD reales; limpia las cuentas y filas que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const administradoresRoutes = require("../routes/administradoresRoutes");
const { requireAdministrador } = require("../middlewares/requireAdministrador");
const { errorHandler } = require("../middlewares/errorHandler");
const { crearCajero } = require("../services/adminUsuariosService");
const { autenticarCajero } = require("../services/authService");
const { query } = require("../config/db");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PREFIJO = `tdsi82-${Date.now()}`;
const cuentasCreadas = [];
let base, servidor;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/administradores", requireAdministrador, administradoresRoutes);
  app.use(errorHandler);
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://localhost:${servidor.address().port}/api/administradores/verificar`;
});

test.after(async () => {
  servidor.close();
  for (const cajero_id of cuentasCreadas) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${cajero_id}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    });
  }
  await query(`DELETE FROM caja.administradores WHERE cajero_id = ANY($1)`, [cuentasCreadas]);
  await query(`DELETE FROM caja.cajeros WHERE usuario LIKE $1`, [`${PREFIJO}%`]);
});

async function cuenta(n, { admin }) {
  const usuario = `${PREFIJO}-${n}`;
  const cajero = await crearCajero({ usuario, password: "clave123", nombre: `Prueba ${n}` });
  cuentasCreadas.push(cajero.cajero_id);
  if (admin) await query(`INSERT INTO caja.administradores (cajero_id, nombre, activo) VALUES ($1, $2, true)`, [cajero.cajero_id, "Admin verificar"]);
  return (await autenticarCajero({ email: usuario, password: "clave123" })).access_token;
}

test("sin token 401 y con un token invalido 401", async () => {
  assert.equal((await fetch(base)).status, 401);
  assert.equal((await fetch(base, { headers: { Authorization: "Bearer no-es-un-token" } })).status, 401);
});

test("un cajero que no es administrador: 403", async () => {
  const token = await cuenta(1, { admin: false });
  assert.equal((await fetch(base, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
});

test("un administrador activo: 200 con su id y nombre", async () => {
  const token = await cuenta(2, { admin: true });
  const r = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const { data } = await r.json();
  assert.equal(data.nombre, "Admin verificar");
  assert.ok(data.administrador_id);
});
