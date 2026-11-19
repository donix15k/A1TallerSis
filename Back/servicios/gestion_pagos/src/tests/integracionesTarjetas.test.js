// TDSI-182: las 3 tarjetas de estado de GET /api/integraciones/resumen (Contabilidad, Compras / Proveedores y Marketplace). Fuentes del
// Monitor FALSAS; Facturacion, Pagos a Proveedores y Gestion de Caja son servidores HTTP locales; los pedidos sincronizados salen de la
// BD real (ventas online de prueba en marzo de 2009, borradas al terminar).
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/integracionesRoutes");
const { usarFuentesDePrueba, mensaje } = require("../services/integraciones/fuentes");
const { colorEstado } = require("../services/integraciones/tarjetas");

let caja, facturacion, proveedores, servidor, base;
let aceptacion; // lo que responde Facturacion: objeto o "caida"
let dias; // lo que responde Pagos a Proveedores: objeto o "caida"
let mensajes; // [{ origen, grupo, estado, fecha }] de las fuentes falsas
let pedidos; // pedidos que recibieron los servicios HTTP: { servicio, url, token }

const fuente = () => ({
  origen: "falsa",
  listar: async () => mensajes.map((m, i) => mensaje({ origen: "falsa", id: i, tipo: "T", referencia: `R${i}`, ...m })),
  reenviar: async () => {},
});
const servicio = (nombre, respuesta) =>
  http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    pedidos.push({ servicio: nombre, url: req.url, token: req.headers.authorization || "" });
    const r = respuesta();
    if (r === "caida") { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, mensaje: `boom ${nombre}` })); }
    res.end(JSON.stringify({ ok: true, data: r }));
  });

test.before(async () => {
  await query(`DELETE FROM pagos.ventas_online WHERE orden_id LIKE 'T182-%'`);
  caja = http.createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: true, data: { administrador_id: "A" } })); });
  facturacion = servicio("facturacion", () => aceptacion);
  proveedores = servicio("proveedores", () => dias);
  for (const s of [caja, facturacion, proveedores]) await new Promise((r) => s.listen(0, r));
  process.env.ADMIN_VERIFICAR_URL = `http://localhost:${caja.address().port}`;
  process.env.FACTURACION_URL = `http://localhost:${facturacion.address().port}`;
  process.env.PAGOS_PROVEEDORES_URL = `http://localhost:${proveedores.address().port}`;

  // marzo de 2009: 3 pedidos sincronizados (uno el primer dia a las 00:30 y otro el ultimo a las 23:30, hora de Bolivia); fuera: 23:50 del 28/02 y 00:10 del 1/04
  const ventas = [["A", "2009-03-01 00:30:00-04"], ["B", "2009-03-15 10:00:00-04"], ["C", "2009-03-31 23:30:00-04"], ["FUERA1", "2009-02-28 23:50:00-04"], ["FUERA2", "2009-04-01 00:10:00-04"]];
  for (const [id, fecha] of ventas) {
    await query(`INSERT INTO pagos.ventas_online (orden_id, total, metodo_pago, codigo_confirmacion, recibida_en) VALUES ($1, 10, 'Efectivo', 'X', $2::timestamptz)`, [`T182-${id}`, fecha]);
  }

  const app = express();
  app.use("/api/integraciones", rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/integraciones/resumen`;
});
test.beforeEach(() => {
  pedidos = [];
  aceptacion = { porcentaje: 98.7, color: "VERDE", registrados: 1104, enviados: 1118, rechazados: 14, sin_respuesta: 0, incompleto: false, sin_asientos: false };
  dias = { ordenes_recibidas: 42, ultima_orden_recibida_en: "2009-03-20T12:00:00.000Z" };
  mensajes = [
    { grupo: "C", estado: "Respondido", fecha: "2009-03-25T10:00:00.000Z" },
    { grupo: "E", estado: "Enviado", fecha: "2009-03-26T10:00:00.000Z" },
  ];
  usarFuentesDePrueba([fuente()]);
});
test.after(async () => {
  usarFuentesDePrueba(null);
  delete process.env.ADMIN_VERIFICAR_URL;
  delete process.env.FACTURACION_URL;
  delete process.env.PAGOS_PROVEEDORES_URL;
  for (const s of [servidor, caja, facturacion, proveedores]) s.close();
  await query(`DELETE FROM pagos.ventas_online WHERE orden_id LIKE 'T182-%'`);
  await pool.end();
});

const pedir = (qs = "?periodo=2009-03", token = "TOK") => fetch(`${base}${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

test("color de Compras y Marketplace: VERDE sin problemas, AMARILLO con mensajes en reintento, ROJO con mensajes en error", () => {
  assert.equal(colorEstado({ errores: 0, reintentos: 0 }), "VERDE");
  assert.equal(colorEstado({ errores: 0, reintentos: 2 }), "AMARILLO");
  assert.equal(colorEstado({ errores: 1, reintentos: 0 }), "ROJO");
  assert.equal(colorEstado({ errores: 1, reintentos: 5 }), "ROJO"); // el error manda sobre el reintento
});

test("Contabilidad: la aceptacion (98,7 % · 1.104 de 1.118) viene del KPI de Facturacion con el token del administrador", async () => {
  const { status, cuerpo } = await pedir();
  assert.equal(status, 200);
  assert.deepEqual([cuerpo.data.periodo, cuerpo.data.desde, cuerpo.data.hasta], ["2009-03", "2009-03-01", "2009-03-31"]);
  const c = cuerpo.data.tarjetas.contabilidad;
  assert.deepEqual([c.disponible, c.porcentaje, c.color, c.registrados, c.enviados, c.rechazados], [true, 98.7, "VERDE", 1104, 1118, 14]);
  const p = pedidos.find((x) => x.servicio === "facturacion");
  assert.match(p.url, /^\/api\/kpis\/aceptacion-contable\?periodo=2009-03/);
  assert.equal(p.token, "Bearer TOK");
});

test("Compras / Proveedores: ordenes recibidas, ultimo mensaje y color segun reintentos y errores del periodo", async () => {
  let c = (await pedir()).cuerpo.data.tarjetas.compras;
  assert.deepEqual([c.disponible, c.ordenes_recibidas, c.mensajes_en_reintento, c.mensajes_en_error, c.color], [true, 42, 0, 0, "VERDE"]);
  assert.equal(c.ultimo_mensaje_en, "2009-03-25T10:00:00.000Z"); // el mensaje del grupo C (25/03) es mas nuevo que la ultima orden (20/03)

  mensajes.push({ grupo: "C", estado: "Pendiente", fecha: "2009-03-10T10:00:00.000Z" });
  c = (await pedir()).cuerpo.data.tarjetas.compras;
  assert.deepEqual([c.mensajes_en_reintento, c.mensajes_en_error, c.color], [1, 0, "AMARILLO"]);

  mensajes.push({ grupo: "C", estado: "Error", fecha: "2009-03-11T10:00:00.000Z" });
  c = (await pedir()).cuerpo.data.tarjetas.compras;
  assert.deepEqual([c.mensajes_en_reintento, c.mensajes_en_error, c.color], [1, 1, "ROJO"]);

  const otroMes = (await pedir("?periodo=2009-05")).cuerpo.data.tarjetas.compras; // los mensajes de marzo no cuentan en mayo
  assert.deepEqual([otroMes.mensajes_en_reintento, otroMes.mensajes_en_error, otroMes.color], [0, 0, "VERDE"]);
  assert.equal(otroMes.ultimo_mensaje_en, "2009-03-25T10:00:00.000Z"); // pero "ultimo mensaje" es el ultimo que hubo, sea del mes que sea
  const p = pedidos.find((x) => x.servicio === "proveedores");
  assert.match(p.url, /^\/api\/kpis\/dias-pago-proveedores\?periodo=2009-0[35]/);
  assert.equal(p.token, "Bearer TOK");
});

test("la ultima orden recibida cuenta como ultimo mensaje si es mas nueva que los mensajes del grupo C", async () => {
  dias = { ordenes_recibidas: 3, ultima_orden_recibida_en: "2009-03-30T12:00:00.000Z" };
  assert.equal((await pedir()).cuerpo.data.tarjetas.compras.ultimo_mensaje_en, "2009-03-30T12:00:00.000Z");
});

test("Marketplace: pedidos sincronizados del mes (BD, hora de Bolivia), mensajes en reintento y color", async () => {
  let m = (await pedir()).cuerpo.data.tarjetas.marketplace;
  assert.deepEqual([m.pedidos_sincronizados, m.mensajes_en_reintento, m.mensajes_en_error, m.color], [3, 0, 0, "VERDE"]);
  mensajes.push({ grupo: "E", estado: "Pendiente", fecha: "2009-03-12T10:00:00.000Z" }, { grupo: "E", estado: "Pendiente", fecha: "2009-03-13T10:00:00.000Z" });
  m = (await pedir()).cuerpo.data.tarjetas.marketplace;
  assert.deepEqual([m.mensajes_en_reintento, m.color], [2, "AMARILLO"]); // "2 mensajes en reintento"
  mensajes.push({ grupo: "E", estado: "Error", fecha: "2009-03-14T10:00:00.000Z" });
  assert.equal((await pedir()).cuerpo.data.tarjetas.marketplace.color, "ROJO");
  assert.equal((await pedir("?periodo=2009-04")).cuerpo.data.tarjetas.marketplace.pedidos_sincronizados, 1); // el de 00:10 del 1/04
});

test("un servicio caido no tumba el resumen: su tarjeta lo dice (disponible false + error) y las demas siguen", async () => {
  aceptacion = "caida";
  dias = "caida";
  const t = (await pedir()).cuerpo.data.tarjetas;
  assert.deepEqual([t.contabilidad.disponible, t.contabilidad.porcentaje, t.contabilidad.error], [false, null, "boom facturacion"]);
  assert.deepEqual([t.compras.disponible, t.compras.ordenes_recibidas, t.compras.error], [false, null, "boom proveedores"]);
  assert.equal(t.compras.color, "VERDE"); // el color de Compras sale de los mensajes del Monitor, no de Pagos a Proveedores
  assert.equal(t.marketplace.disponible, true);
  process.env.FACTURACION_URL = "http://localhost:1";
  try {
    assert.match((await pedir()).cuerpo.data.tarjetas.contabilidad.error, /No se pudo conectar con Facturación/);
  } finally {
    process.env.FACTURACION_URL = `http://localhost:${facturacion.address().port}`;
  }
});

test("los totales por grupo siguen en el resumen junto a las tarjetas; periodo invalido 400; sin periodo usa el mes actual", async () => {
  const d = (await pedir()).cuerpo.data;
  assert.deepEqual(d.grupos.map((g) => g.grupo), ["C", "D", "E"]);
  assert.ok(d.total && d.actualizado_en);
  assert.equal((await pedir("?periodo=2009-13")).status, 400);
  assert.match((await pedir("")).cuerpo.data.periodo, /^\d{4}-\d{2}$/);
  assert.equal((await pedir("?periodo=2009-03", null)).status, 401);
});
