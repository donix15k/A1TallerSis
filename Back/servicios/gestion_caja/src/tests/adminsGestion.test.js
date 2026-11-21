// "Usuarios y accesos": crear y gestionar administradores, restablecer credenciales (incluido el PIN de supervisores) y el perfil propio.
// Supabase Auth y BD reales: crea 2 cuentas de administrador de prueba y 1 cajero, y las borra al terminar. Facturacion (supervisores) es un
// servidor HTTP local: NO se crea ningun supervisor real.
process.env.FACTURACION_URL = "http://localhost:48231";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const { requireAdministrador } = require("../middlewares/requireAdministrador");
const administradoresRoutes = require("../routes/administradoresRoutes");
const usuariosRoutes = require("../routes/usuariosRoutes");
const administradoresRepo = require("../data/administradoresRepo");
const servicio = require("../services/adminUsuariosService");
const { autenticarAdministrador } = require("../services/administradorAuthService");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PREFIJO = `tdsi-adm-${Date.now()}`;
const correo = (n) => `${PREFIJO}-${n}@test.com`;
const cuentas = [];
let a, b, cajero, servidor, base, facturacion, llamadasFacturacion;

const limpiar = async () => {
  for (const id of cuentas) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
  }
  await query(`DELETE FROM caja.administradores WHERE cajero_id = ANY($1)`, [cuentas]);
  await query(`DELETE FROM caja.cajeros WHERE cajero_id = ANY($1)`, [cuentas]);
};

test.before(async () => {
  facturacion = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => { cuerpo += c; });
    req.on("end", () => {
      llamadasFacturacion.push({ metodo: req.method, url: req.url, cuerpo: cuerpo ? JSON.parse(cuerpo) : null });
      res.setHeader("Content-Type", "application/json");
      if (req.method === "GET") return res.end(JSON.stringify({ ok: true, data: [] })); // la lista de supervisores
      const pin = cuerpo ? JSON.parse(cuerpo).pin : null;
      if (pin !== null && pin !== undefined && !/^\d{4,6}$/.test(String(pin))) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, mensaje: "El PIN debe tener entre 4 y 6 dígitos" })); }
      res.statusCode = req.method === "POST" ? 201 : 200;
      res.end(JSON.stringify({ ok: true, data: { id: 77, usuario: "sup.prueba", nombre: "Sup Prueba", estado: "Activo" } }));
    });
  });
  await new Promise((r) => facturacion.listen(48231, r));
  llamadasFacturacion = [];

  a = await servicio.crearAdministrador({ usuario: correo("a"), password: "Clave1234", nombre: "Ana Admin", telefono: "+591 70000001", documento: "1234567" });
  b = await servicio.crearAdministrador({ usuario: correo("b"), password: "Clave1234", nombre: "Beto Admin" });
  cuentas.push(a.id, b.id);
  cajero = await servicio.crearCajero({ usuario: correo("c"), password: "clave123", nombre: "Carla Cajera" });
  cuentas.push(cajero.cajero_id);

  const app = express();
  app.use(express.json());
  app.use("/api/administradores", requireAdministrador, administradoresRoutes);
  app.use("/api/usuarios", requireAdministrador, usuariosRoutes);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api`;
});
test.beforeEach(() => { llamadasFacturacion = []; });
test.after(async () => {
  servidor.close();
  facturacion.close();
  await limpiar();
  await pool.end();
});

const token = async (email, password) => (await autenticarAdministrador({ email, password })).access_token;
const pedir = (metodo, ruta, cuerpo, tk) =>
  fetch(`${base}${ruta}`, { method: metodo, headers: { "Content-Type": "application/json", ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

// ---------------------------------------------------------------- crear administradores
test("crear un administrador: queda con su correo y datos personales, aparece en la lista como Administrador y puede iniciar sesion", async () => {
  assert.deepEqual([a.usuario, a.nombre, a.telefono, a.documento, a.rol, a.estado], [correo("a"), "Ana Admin", "+591 70000001", "1234567", "Administrador", "Activo"]);
  const lista = await servicio.listarUsuarios();
  const mio = lista.find((u) => u.id === a.id);
  assert.deepEqual([mio.rol, mio.estado, mio.usuario], ["Administrador", "Activo", correo("a")]);
  const sesion = await autenticarAdministrador({ email: correo("a"), password: "Clave1234" });
  assert.equal(sesion.nombre, "Ana Admin");
  assert.ok(sesion.refresh_token);
});

test("crear un administrador: correo invalido, contrasena de menos de 8, sin nombre, telefono o documento raros y correo repetido son rechazados", async () => {
  const ok = { usuario: correo("x"), password: "Clave1234", nombre: "X" };
  const casos = [
    [{ ...ok, usuario: "no-es-correo" }, 400], [{ ...ok, password: "1234567" }, 400], [{ ...ok, password: "" }, 400], [{ ...ok, nombre: "  " }, 400],
    [{ ...ok, telefono: "abc" }, 400], [{ ...ok, documento: "12" }, 400], [{ ...ok, usuario: correo("a") }, 409], [{ ...ok, usuario: correo("a").toUpperCase() }, 409], [{ ...ok, usuario: correo("c") }, 409],
  ];
  for (const [datos, status] of casos) await assert.rejects(servicio.crearAdministrador(datos), (e) => e.status === status, JSON.stringify(datos));
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM caja.administradores WHERE usuario LIKE $1`, [`${PREFIJO}-x%`]);
  assert.equal(rows[0].n, 0);
});

// ---------------------------------------------------------------- editar, desactivar, restablecer
test("editar un administrador: nombre, telefono, documento y correo (tambien en Supabase)", async () => {
  const r = await servicio.editarUsuario(b.id, { usuario: correo("b2"), nombre: "Beto Editado", telefono: "70011223", documento: "ABC-12345" });
  assert.deepEqual([r.usuario, r.nombre, r.telefono, r.documento], [correo("b2"), "Beto Editado", "70011223", "ABC-12345"]);
  assert.ok(await token(correo("b2"), "Clave1234")); // el login ya es con el correo nuevo
  await assert.rejects(autenticarAdministrador({ email: correo("b"), password: "Clave1234" }), (e) => e.status === 401);
  await assert.rejects(servicio.editarUsuario(b.id, { usuario: correo("a"), nombre: "X" }), (e) => e.status === 409); // el correo de otro
});

test("desactivar ('dar de baja') a un administrador: ya no inicia sesion; al reactivarlo vuelve; nadie puede desactivarse a si mismo", async () => {
  await assert.rejects(servicio.cambiarEstadoUsuario(a.id, { activo: false }, { solicitante_id: a.id }), (e) => e.status === 409 && /propia cuenta/.test(e.message));
  const baja = await servicio.cambiarEstadoUsuario(b.id, { activo: false }, { solicitante_id: a.id });
  assert.equal(baja.estado, "Inactivo");
  await assert.rejects(autenticarAdministrador({ email: correo("b2"), password: "Clave1234" }), (e) => e.status === 403);
  // con la cuenta dada de baja tampoco sirve un token que ya tuviera
  const alta = await servicio.cambiarEstadoUsuario(b.id, { activo: true }, { solicitante_id: a.id });
  assert.equal(alta.estado, "Activo");
  assert.ok(await token(correo("b2"), "Clave1234"));
});

test("siempre debe quedar al menos un administrador activo", async () => {
  const original = administradoresRepo.contarActivos;
  administradoresRepo.contarActivos = async () => 1; // como si b fuera el unico activo
  try {
    await assert.rejects(servicio.cambiarEstadoUsuario(b.id, { activo: false }, { solicitante_id: a.id }), (e) => e.status === 409 && /al menos un administrador activo/.test(e.message));
  } finally {
    administradoresRepo.contarActivos = original;
  }
  assert.equal((await administradoresRepo.buscarPorCajeroId(b.id)).activo, true);
});

test("restablecer la contrasena de un administrador (8+ caracteres) y la de un cajero; el login ya usa la nueva", async () => {
  await assert.rejects(servicio.restablecerCredencial(a.id, { password: "corta" }), (e) => e.status === 400);
  await servicio.restablecerCredencial(a.id, { password: "NuevaClave99" });
  await assert.rejects(autenticarAdministrador({ email: correo("a"), password: "Clave1234" }), (e) => e.status === 401);
  assert.ok(await token(correo("a"), "NuevaClave99"));
  await servicio.restablecerCredencial(cajero.cajero_id, { password: "cajero2026" });
  const { autenticarCajero } = require("../services/authService");
  assert.ok((await autenticarCajero({ email: correo("c"), password: "cajero2026" })).access_token);
});

test("supervisores: se crean y se les restablece el PIN a traves de Facturacion (dueno de ese registro); un PIN invalido es 400", async () => {
  const s = await servicio.crearSupervisor({ usuario: "sup.prueba", nombre: "Sup Prueba", pin: "4321" });
  assert.equal(s.nombre, "Sup Prueba");
  assert.deepEqual(llamadasFacturacion[0], { metodo: "POST", url: "/api/supervisores", cuerpo: { usuario: "sup.prueba", nombre: "Sup Prueba", pin: "4321" } });
  await servicio.restablecerCredencial("77", { pin: "9876" }); // un id que no es de administrador ni de cajero: es un supervisor
  assert.deepEqual(llamadasFacturacion[1], { metodo: "PUT", url: "/api/supervisores/77/pin", cuerpo: { pin: "9876" } });
  await assert.rejects(servicio.restablecerCredencial("77", { pin: "12" }), (e) => e.status === 400 && /PIN/.test(e.message));
  await assert.rejects(servicio.crearSupervisor({ usuario: "x", nombre: "x", pin: "abc" }), (e) => e.status === 400);
});

// ---------------------------------------------------------------- HTTP y perfil propio
test("por HTTP: crear, listar y restablecer son solo del administrador (401 sin token) y un cajero no puede (403)", async () => {
  assert.equal((await pedir("POST", "/usuarios/administradores", { usuario: correo("z"), password: "Clave1234", nombre: "Z" })).status, 401);
  assert.equal((await pedir("GET", "/administradores/perfil")).status, 401);
  const { autenticarCajero } = require("../services/authService");
  const tkCajero = (await autenticarCajero({ email: correo("c"), password: "cajero2026" })).access_token;
  assert.equal((await pedir("POST", "/usuarios/administradores", { usuario: correo("z"), password: "Clave1234", nombre: "Z" }, tkCajero)).status, 403);
  const tkA = await token(correo("a"), "NuevaClave99");
  const creado = await pedir("POST", "/usuarios/administradores", { usuario: correo("d"), password: "Clave1234", nombre: "Dora Admin" }, tkA);
  assert.equal(creado.status, 201);
  cuentas.push(creado.cuerpo.data.id);
  const lista = await pedir("GET", "/usuarios", null, tkA);
  assert.ok(lista.cuerpo.data.some((u) => u.id === creado.cuerpo.data.id && u.rol === "Administrador"));
});

test("el perfil propio: ver, cambiar nombre y datos personales (no el correo ni el estado)", async () => {
  const tk = await token(correo("a"), "NuevaClave99");
  const ver = await pedir("GET", "/administradores/perfil", null, tk);
  assert.deepEqual([ver.status, ver.cuerpo.data.usuario, ver.cuerpo.data.nombre, ver.cuerpo.data.rol], [200, correo("a"), "Ana Admin", "Administrador"]);
  const edit = await pedir("PUT", "/administradores/perfil", { nombre: "Ana María Admin", telefono: "71234567", documento: "9876543", usuario: "otro@x.com", activo: false }, tk);
  assert.equal(edit.status, 200);
  assert.deepEqual([edit.cuerpo.data.nombre, edit.cuerpo.data.telefono, edit.cuerpo.data.documento, edit.cuerpo.data.usuario, edit.cuerpo.data.estado], ["Ana María Admin", "71234567", "9876543", correo("a"), "Activo"]);
  assert.equal((await pedir("PUT", "/administradores/perfil", { nombre: "" }, tk)).status, 400);
  assert.equal((await pedir("PUT", "/administradores/perfil", { nombre: "Ana", telefono: "xx" }, tk)).status, 400);
});

test("cambiar la contrasena propia: exige la actual, 8+ caracteres y distinta de la actual; despues el login usa la nueva", async () => {
  const tk = await token(correo("a"), "NuevaClave99");
  const put = (cuerpo) => pedir("PUT", "/administradores/perfil/password", cuerpo, tk);
  assert.equal((await put({ password_nueva: "OtraClave123" })).status, 400); // falta la actual
  assert.equal((await put({ password_actual: "MAL-ACTUAL", password_nueva: "OtraClave123" })).status, 403);
  assert.equal((await put({ password_actual: "NuevaClave99", password_nueva: "corta" })).status, 400);
  assert.equal((await put({ password_actual: "NuevaClave99", password_nueva: "NuevaClave99" })).status, 400);
  const ok = await put({ password_actual: "NuevaClave99", password_nueva: "TerceraClave77" });
  assert.equal(ok.status, 200);
  assert.ok(await token(correo("a"), "TerceraClave77"));
  await assert.rejects(autenticarAdministrador({ email: correo("a"), password: "NuevaClave99" }), (e) => e.status === 401);
});
