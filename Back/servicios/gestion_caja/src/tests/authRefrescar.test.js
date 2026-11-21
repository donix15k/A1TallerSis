// Renovar la sesion con el refresh_token de Supabase (el access_token dura 1 hora). Supabase Auth y BD reales: crea UNA cuenta de prueba y la borra.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { errorHandler } = require("../middlewares/errorHandler");
const authRoutes = require("../routes/authRoutes");
const { crearCajero } = require("../services/adminUsuariosService");
const { autenticarCajero, renovarSesion } = require("../services/authService");
const { query, pool } = require("../config/db");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = `tdsi-refresco-${Date.now()}@test.com`;
let cuenta, servidor, base, sesion;

test.before(async () => {
  cuenta = await crearCajero({ usuario: EMAIL, password: "clave123", nombre: "Prueba Refresco" });
  sesion = await autenticarCajero({ email: EMAIL, password: "clave123" });
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/auth`;
});
test.after(async () => {
  servidor.close();
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${cuenta.cajero_id}`, { method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
  await query(`DELETE FROM caja.cajeros WHERE usuario = $1`, [EMAIL]);
  await pool.end();
});

test("el login ahora devuelve el refresh_token y cuanto dura el access_token", () => {
  assert.ok(sesion.access_token);
  assert.ok(sesion.refresh_token);
  assert.equal(sesion.expires_in, 3600);
});

test("renovar: con el refresh_token se obtiene un access_token nuevo (y un refresh_token nuevo) que sigue siendo de la misma cuenta", async () => {
  const r = await renovarSesion({ refresh_token: sesion.refresh_token });
  assert.ok(r.access_token && r.refresh_token);
  assert.notEqual(r.access_token, sesion.access_token);
  assert.notEqual(r.refresh_token, sesion.refresh_token); // Supabase lo rota
  const usuario = await (await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${r.access_token}` } })).json();
  assert.equal(usuario.email, EMAIL);
  sesion = { ...sesion, ...r }; // el siguiente paso usa el vigente
});

test("por HTTP: POST /api/auth/refrescar devuelve la sesion renovada; sin refresh_token es 400; uno falso es 401", async () => {
  const post = (cuerpo) => fetch(`${base}/refrescar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }).then(async (x) => ({ status: x.status, cuerpo: await x.json() }));
  const ok = await post({ refresh_token: sesion.refresh_token });
  assert.equal(ok.status, 200);
  assert.ok(ok.cuerpo.data.access_token && ok.cuerpo.data.refresh_token);
  assert.equal(ok.cuerpo.data.expires_in, 3600);
  assert.equal((await post({})).status, 400);
  const falso = await post({ refresh_token: "no-es-un-token" });
  assert.equal(falso.status, 401);
  assert.match(falso.cuerpo.mensaje, /vuelva a iniciar sesion/);
});
