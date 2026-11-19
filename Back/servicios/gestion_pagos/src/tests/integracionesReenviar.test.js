// TDSI-129: POST /api/integraciones/mensajes/:origen/:id/reenviar delega en el microservicio dueno. Los duenos son servidores
// HTTP locales (nunca se publica nada de verdad); el administrador se valida contra un Gestion de Caja local.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/integracionesRoutes");
const { usarFuentesDePrueba, fuentes: _f } = require("../services/integraciones/fuentes");
const { reenviarMensaje } = require("../services/integracionesService");

let caja, facturacion, devoluciones, servidor, base;
let llamadas;
let envios; // estado del envio 13 de facturacion

test.before(async () => {
  caja = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (token === "ADMIN") return res.end(JSON.stringify({ ok: true, data: { administrador_id: "A" } }));
    res.statusCode = token === "CAJERO" ? 403 : 401;
    res.end(JSON.stringify({ ok: false, mensaje: "no" }));
  });
  facturacion = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    llamadas.push({ servicio: "facturacion", metodo: req.method, url: req.url, auth: req.headers.authorization || null });
    const m = req.url.match(/^\/api\/facturas\/envios-contabilidad\/(\d+)\/reenviar$/);
    if (req.method === "GET") {
      return res.end(JSON.stringify({ ok: true, data: { total: 1, envios: [{ id: 13, factura_numero: "F-000013", tipo: "venta", estado: envios[13], intentos: 1, pubsub_message_id: envios[13] === "Enviado" ? "nuevo-msg" : null, creado_en: "2026-03-10T10:00:00.000Z", enviado_en: null, resultado: null }] } }));
    }
    if (!m) { res.statusCode = 404; return res.end("{}"); }
    if (Number(m[1]) !== 13) { res.statusCode = 404; return res.end(JSON.stringify({ ok: false, mensaje: `El envio ${m[1]} no existe.` })); }
    if (envios[13] !== "Error") { res.statusCode = 409; return res.end(JSON.stringify({ ok: false, mensaje: `Solo se pueden reenviar envios con estado Error (este esta ${envios[13]}).` })); }
    envios[13] = "Enviado";
    res.end(JSON.stringify({ ok: true, data: { id: 13, estado: "Enviado" } }));
  });
  devoluciones = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    llamadas.push({ servicio: "devoluciones", metodo: req.method, url: req.url, auth: req.headers.authorization || null });
    if (req.method === "GET") return res.end(JSON.stringify({ ok: true, data: [] }));
    res.end(JSON.stringify({ ok: true, data: { id: "compras-2", estado: "Enviado" } }));
  });
  for (const s of [caja, facturacion, devoluciones]) await new Promise((r) => s.listen(0, r));
  const u = (s) => `http://localhost:${s.address().port}`;
  process.env.ADMIN_VERIFICAR_URL = u(caja);
  process.env.FACTURACION_URL = u(facturacion);
  process.env.DEVOLUCIONES_URL = u(devoluciones);
  usarFuentesDePrueba(null); // las fuentes REALES (facturacion y devoluciones apuntan a los stubs)
  const app = express();
  app.use("/api/integraciones", rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/integraciones/mensajes`;
});
test.beforeEach(() => { llamadas = []; envios = { 13: "Error" }; });
test.after(() => { delete process.env.ADMIN_VERIFICAR_URL; for (const s of [servidor, caja, facturacion, devoluciones]) s.close(); });

const reenviar = (origen, id, token = "ADMIN") => fetch(`${base}/${origen}/${id}/reenviar`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

test("reenvia llamando al endpoint de reenvio del microservicio DUENO y devuelve el mensaje actualizado", async () => {
  const r = await reenviar("facturacion", 13);
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.mensaje, "Mensaje reenviado");
  const post = llamadas.find((l) => l.metodo === "POST");
  assert.deepEqual([post.servicio, post.url], ["facturacion", "/api/facturas/envios-contabilidad/13/reenviar"]);
  assert.deepEqual([r.cuerpo.data.origen, r.cuerpo.data.id, r.cuerpo.data.estado, r.cuerpo.data.message_id, r.cuerpo.data.puede_reenviar], ["facturacion", "13", "Enviado", "nuevo-msg", false]);
});

test("el monitor no publica nada por su cuenta: solo hay UN POST, al dueno", async () => {
  await reenviar("facturacion", 13);
  assert.equal(llamadas.filter((l) => l.metodo === "POST").length, 1);
});

test("a Devoluciones se le reenvia el token del administrador y el id compuesto (compras-2)", async () => {
  const r = await reenviar("devoluciones", "compras-2");
  assert.equal(r.status, 200);
  const post = llamadas.find((l) => l.servicio === "devoluciones" && l.metodo === "POST");
  assert.equal(post.url, "/api/integraciones/mensajes/compras-2/reenviar");
  assert.equal(post.auth, "Bearer ADMIN");
});

test("los errores del dueno se propagan con su estado: 409 si no esta en Error, 404 si no existe", async () => {
  envios[13] = "Enviado";
  const r = await reenviar("facturacion", 13);
  assert.equal(r.status, 409);
  assert.match(r.cuerpo.mensaje, /Solo se pueden reenviar envios con estado Error/);
  const n = await reenviar("facturacion", 99);
  assert.equal(n.status, 404);
  assert.match(n.cuerpo.mensaje, /no existe/);
});

test("origen desconocido o id invalido dan 400 y no se llama a nadie", async () => {
  assert.equal((await reenviar("marte", 1)).status, 400);
  assert.equal((await reenviar("facturacion", "1;drop")).status, 400);
  assert.equal(llamadas.length, 0);
  await assert.rejects(reenviarMensaje({ origen: "facturacion", id: "" }), (e) => e.status === 400);
});

test("el dueno caido da 503 con un mensaje claro", async () => {
  const antes = process.env.FACTURACION_URL;
  process.env.FACTURACION_URL = "http://localhost:1";
  try {
    const r = await reenviar("facturacion", 13);
    assert.equal(r.status, 503);
    assert.match(r.cuerpo.mensaje, /no se pudo conectar/);
  } finally {
    process.env.FACTURACION_URL = antes;
  }
});

test("solo el administrador: sin token 401, cajero 403, y no se llama al dueno", async () => {
  assert.equal((await reenviar("facturacion", 13, null)).status, 401);
  assert.equal((await reenviar("facturacion", 13, "CAJERO")).status, 403);
  assert.equal(llamadas.length, 0);
});
