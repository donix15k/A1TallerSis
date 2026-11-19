// TDSI-128: GET /api/integraciones/resumen (totales por grupo y por estado). Fuentes FALSAS; el administrador se valida contra un Caja local.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/integracionesRoutes");
const { usarFuentesDePrueba, mensaje } = require("../services/integraciones/fuentes");

let caja, servidor, base;
let fallaOrigen = null;

const fuente = (origen, grupo, estados) => ({
  origen,
  listar: async () => {
    if (fallaOrigen === origen) throw new Error("no respondio");
    return estados.map((estado, i) => mensaje({ origen, id: i, grupo, tipo: "T", referencia: `${origen}-${i}`, fecha: "2026-03-10T10:00:00.000Z", estado }));
  },
  reenviar: async () => {},
});

test.before(async () => {
  caja = http.createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: true, data: { administrador_id: "A" } })); });
  await new Promise((r) => caja.listen(0, r));
  process.env.ADMIN_VERIFICAR_URL = `http://localhost:${caja.address().port}`;
  const app = express();
  app.use("/api/integraciones", rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/integraciones/resumen`;
});
test.beforeEach(() => {
  fallaOrigen = null;
  usarFuentesDePrueba([
    fuente("facturacion", "D", ["Enviado", "Enviado", "Respondido", "Error"]),
    fuente("gestion_caja", "D", ["Pendiente", "Respondido"]),
    fuente("compras", "C", ["Enviado", "Error", "Error"]),
    fuente("marketplace", "E", ["Enviado"]),
  ]);
});
test.after(() => { usarFuentesDePrueba(null); delete process.env.ADMIN_VERIFICAR_URL; servidor.close(); caja.close(); });

const pedir = (token = "X") => fetch(base, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

test("totales por grupo (Compras, Contabilidad, Marketplace) y por estado, mas el total general", async () => {
  const { status, cuerpo } = await pedir();
  assert.equal(status, 200);
  const g = Object.fromEntries(cuerpo.data.grupos.map((x) => [x.grupo, x]));
  assert.deepEqual(g.D, { grupo: "D", nombre: "Contabilidad", total: 6, enviados: 2, respondidos: 2, pendientes: 1, errores: 1 });
  assert.deepEqual(g.C, { grupo: "C", nombre: "Compras", total: 3, enviados: 1, respondidos: 0, pendientes: 0, errores: 2 });
  assert.deepEqual(g.E, { grupo: "E", nombre: "Marketplace", total: 1, enviados: 1, respondidos: 0, pendientes: 0, errores: 0 });
  assert.deepEqual(cuerpo.data.total, { total: 10, enviados: 4, respondidos: 2, pendientes: 1, errores: 3 });
  assert.ok(cuerpo.data.actualizado_en);
});

test("los tres grupos aparecen siempre, aunque no haya mensajes (todo en 0)", async () => {
  usarFuentesDePrueba([fuente("facturacion", "D", [])]);
  const { cuerpo } = await pedir();
  assert.deepEqual(cuerpo.data.grupos.map((x) => [x.grupo, x.total]), [["C", 0], ["D", 0], ["E", 0]]);
  assert.equal(cuerpo.data.total.total, 0);
});

test("cada grupo cuadra: total = enviados + respondidos + pendientes + errores", async () => {
  for (const x of (await pedir()).cuerpo.data.grupos) assert.equal(x.total, x.enviados + x.respondidos + x.pendientes + x.errores);
});

test("un servicio caido se informa en fuentes y el resumen sigue con lo demas", async () => {
  fallaOrigen = "compras";
  const { cuerpo } = await pedir();
  assert.deepEqual(cuerpo.data.fuentes.filter((f) => !f.ok).map((f) => f.origen), ["compras"]);
  assert.equal(cuerpo.data.grupos.find((x) => x.grupo === "C").total, 0);
  assert.equal(cuerpo.data.grupos.find((x) => x.grupo === "D").total, 6);
});

test("es solo del administrador: sin token 401", async () => {
  process.env.ADMIN_VERIFICAR_URL = "http://localhost:1";
  try {
    assert.equal((await pedir(null)).status, 401);
    assert.equal((await pedir("X")).status, 503); // Caja caida: no se puede validar al administrador
  } finally {
    process.env.ADMIN_VERIFICAR_URL = `http://localhost:${caja.address().port}`;
  }
});
