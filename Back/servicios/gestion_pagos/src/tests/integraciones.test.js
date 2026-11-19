// TDSI-126: GET /api/integraciones/mensajes reune los envios de facturacion, gestion_caja, pagos_proveedores, devoluciones y
// los propios (Compras y Marketplace). Los otros microservicios son servidores HTTP locales; lo propio se lee de la base real
// (filas insertadas DIRECTO, nunca por Pub/Sub) y se borra al terminar.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/integracionesRoutes");

const SUF = String(Date.now()).slice(-8);
let servicios = {}; // nombre -> { servidor, respuesta }
let base, app;
const TOKEN_ADMIN = "ADMIN-OK";

function stub(manejador) {
  const s = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    manejador(req, res);
  });
  return new Promise((r) => s.listen(0, () => r(s)));
}
const url = (s) => `http://localhost:${s.address().port}`;

test.before(async () => {
  servicios.facturacion = await stub((req, res) => res.end(JSON.stringify({ ok: true, data: { total: 3, envios: [
    { id: 11, factura_numero: `F-T${SUF}`, tipo: "venta", estado: "Enviado", intentos: 1, ultimo_error: null, pubsub_message_id: "fm-1", enviado_en: "2026-03-10T15:00:00.000Z", creado_en: "2026-03-10T14:59:00.000Z", resultado: null },
    { id: 12, factura_numero: `F-T${SUF}`, tipo: "anulacion", estado: "Enviado", intentos: 1, ultimo_error: null, pubsub_message_id: "fm-2", enviado_en: "2026-03-10T16:00:00.000Z", creado_en: "2026-03-10T15:59:00.000Z", resultado: "registrado", numero_asiento: "A-77" },
    { id: 13, factura_numero: `F-U${SUF}`, tipo: "venta", estado: "Error", intentos: 3, ultimo_error: "Pub/Sub: caido", pubsub_message_id: null, enviado_en: null, creado_en: "2026-03-09T10:00:00.000Z", resultado: null },
  ] } })));
  servicios.caja = await stub((req, res) => {
    if (req.url === "/api/administradores/verificar") {
      const token = (req.headers.authorization || "").replace("Bearer ", "");
      if (token === TOKEN_ADMIN) return res.end(JSON.stringify({ ok: true, data: { administrador_id: "ADM-1", nombre: "Admin" } }));
      res.statusCode = token === "CAJERO" ? 403 : 401;
      return res.end(JSON.stringify({ ok: false, mensaje: token === "CAJERO" ? "Esta accion requiere permisos de Administrador." : "Token invalido o vencido" }));
    }
    res.end(JSON.stringify({ ok: true, data: [
      { id: 5, turno_id: 9, monto: 12.5, tipo: "FALTANTE", estado: "RESUELTA", resuelta_en: "2026-03-10T12:00:00.000Z", contabilidad: { estado: "Enviado", intentos: 1, ultimo_error: null, motivo_rechazo: null } },
      { id: 6, turno_id: 9, monto: 3, tipo: "SOBRANTE", estado: "PENDIENTE", resuelta_en: null, contabilidad: null }, // sin aviso: no es un mensaje
    ] }));
  });
  servicios.proveedores = await stub((req, res) => res.end(JSON.stringify({ ok: true, data: { total: 1, envios: [
    { id: 21, lote_id: 4, fecha: "2026-03-08", estado: "PENDIENTE", intentos: 2, ultimo_error: "timeout", pubsub_message_id: null, enviado_en: null, creado_en: "2026-03-08T20:00:00.000Z", referencia_contabilidad: null },
  ] } })));
  servicios.devoluciones = await stub((req, res) => {
    if (!req.headers.authorization) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, mensaje: "Token de acceso requerido" })); }
    res.end(JSON.stringify({ ok: true, total: 2, data: [
      { origen: "devoluciones", id: "contabilidad-3", fuente: "contabilidad", grupo: "D", tipo: "NOTA_CREDITO", referencia: "NC-000003", fecha: "2026-03-10T17:00:00.000Z", estado: "Respondido", message_id: "dm-1", intentos: 1, error: null, puede_reenviar: false, detalle: { numero_asiento: "A-9" }, datos: null },
      { origen: "devoluciones", id: "compras-2", fuente: "compras", grupo: "C", tipo: "PRODUCTOS_DEVUELTOS", referencia: "DEV-0002", fecha: "2026-03-10T18:00:00.000Z", estado: "Error", message_id: null, intentos: 5, error: "Pub/Sub: PERMISSION_DENIED", puede_reenviar: true, detalle: {}, datos: null },
    ] }));
  });
  process.env.FACTURACION_URL = url(servicios.facturacion);
  process.env.GESTION_CAJA_URL = url(servicios.caja);
  process.env.PAGOS_PROVEEDORES_URL = url(servicios.proveedores);
  process.env.DEVOLUCIONES_URL = url(servicios.devoluciones);
  delete process.env.ADMIN_VERIFICAR_URL;

  // lo propio: un reporte diario a Compras (C) y el aviso de una venta online al Marketplace (E)
  await query(`INSERT INTO pagos.envios_compras (fecha, reporte_id, estado, intentos, pubsub_message_id, enviado_en) VALUES ('2001-02-03', 'PV-2001-02-03', 'Recibido', 1, $1, '2026-03-10T13:00:00Z')`, [`pm-${SUF}`]);
  const v = await query(`INSERT INTO pagos.ventas_online (orden_id, total, metodo_pago, estado, codigo_confirmacion, numero_factura, aviso_marketplace_estado, aviso_marketplace_error) VALUES ($1, 80, 'QR', 'Pagado', 'C', 'F-000001', 'Error', 'Pub/Sub: caido') RETURNING id`, [`ORD-T126-${SUF}`]);
  void v;

  app = express();
  app.use(express.json());
  app.use("/api/integraciones", rutas);
  app.use(errorHandler);
  const s = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
  servicios.app = s;
  base = `http://localhost:${s.address().port}/api/integraciones`;
});

test.after(async () => {
  await query(`DELETE FROM pagos.envios_compras WHERE reporte_id = 'PV-2001-02-03'`);
  await query(`DELETE FROM pagos.ventas_online WHERE orden_id = $1`, [`ORD-T126-${SUF}`]);
  for (const s of Object.values(servicios)) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
  await pool.end();
});

const pedir = (ruta, token = TOKEN_ADMIN) => fetch(`${base}${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test("reune los mensajes de las SEIS fuentes en un formato comun (grupo, tipo, fecha, estado y messageId)", async () => {
  const r = await pedir("/mensajes");
  assert.equal(r.status, 200);
  const { fuentes, data } = await r.json();
  assert.deepEqual(fuentes.map((f) => [f.origen, f.ok]), [
    ["facturacion", true], ["gestion_caja", true], ["pagos_proveedores", true], ["devoluciones", true], ["gestion_pagos_compras", true], ["gestion_pagos_marketplace", true],
  ]);
  const por = (origen) => data.filter((m) => m.origen === origen);
  for (const m of data) {
    assert.deepEqual(Object.keys(m).sort(), ["datos", "detalle", "error", "estado", "fecha", "grupo", "id", "intentos", "message_id", "origen", "puede_reenviar", "referencia", "tipo"]);
    assert.ok(["C", "D", "E"].includes(m.grupo));
    assert.ok(["Enviado", "Respondido", "Pendiente", "Error"].includes(m.estado), m.estado);
  }
  assert.equal(por("facturacion").length, 3);
  assert.deepEqual(por("facturacion").map((m) => [m.id, m.tipo, m.referencia, m.estado, m.message_id]).sort(), [
    ["11", "FACTURA_VENTA", `F-T${SUF}`, "Enviado", "fm-1"],
    ["12", "FACTURA_ANULACION", `ANU-F-T${SUF}`, "Respondido", "fm-2"],
    ["13", "FACTURA_VENTA", `F-U${SUF}`, "Error", null],
  ].sort());
  assert.equal(por("facturacion").find((m) => m.id === "12").detalle.numero_asiento, "A-77");
  assert.deepEqual(por("gestion_caja").map((m) => [m.id, m.grupo, m.tipo, m.referencia, m.estado]), [["5", "D", "DIFERENCIA_CAJA", "DIF-5", "Enviado"]]); // la diferencia sin aviso no sale
  assert.deepEqual(por("pagos_proveedores").map((m) => [m.id, m.grupo, m.tipo, m.referencia, m.estado, m.error]), [["21", "D", "LOTE_CIERRE", "LOTE-4", "Pendiente", "timeout"]]);
  assert.deepEqual(por("devoluciones").map((m) => [m.id, m.grupo, m.tipo, m.estado]).sort(), [["compras-2", "C", "PRODUCTOS_DEVUELTOS", "Error"], ["contabilidad-3", "D", "NOTA_CREDITO", "Respondido"]]);
  const compras = por("gestion_pagos_compras").find((m) => m.message_id === `pm-${SUF}`);
  assert.deepEqual([compras.grupo, compras.tipo, compras.referencia, compras.estado], ["C", "PRODUCTOS_VENDIDOS", "PV-2001-02-03", "Respondido"]);
  const mkt = por("gestion_pagos_marketplace").find((m) => m.referencia === `ORD-T126-${SUF}`);
  assert.deepEqual([mkt.grupo, mkt.tipo, mkt.estado, mkt.error, mkt.puede_reenviar], ["E", "FACTURA_EMITIDA", "Error", "Pub/Sub: caido", true]);
});

test("van del mas reciente al mas antiguo y solo los Error se pueden reenviar", async () => {
  const { data } = await (await pedir("/mensajes")).json();
  const fechas = data.map((m) => new Date(m.fecha || 0).getTime());
  assert.deepEqual(fechas, [...fechas].sort((a, b) => b - a));
  for (const m of data) assert.equal(m.puede_reenviar, m.estado === "Error", `${m.origen}:${m.id}`);
});

test("un servicio caido no deja ciega a la pantalla: se muestran los demas y se avisa cual fallo", async () => {
  const urlAntes = process.env.PAGOS_PROVEEDORES_URL;
  process.env.PAGOS_PROVEEDORES_URL = "http://localhost:1";
  try {
    const { fuentes, data } = await (await pedir("/mensajes")).json();
    const f = fuentes.find((x) => x.origen === "pagos_proveedores");
    assert.deepEqual([f.ok, f.total], [false, 0]);
    assert.match(f.error, /no se pudo conectar/);
    assert.ok(data.some((m) => m.origen === "facturacion")); // el resto sigue
    assert.ok(!data.some((m) => m.origen === "pagos_proveedores"));
  } finally {
    process.env.PAGOS_PROVEEDORES_URL = urlAntes;
  }
});

test("solo el administrador: sin token 401, token invalido 401, cajero 403, Caja caida 503", async () => {
  assert.equal((await pedir("/mensajes", null)).status, 401);
  assert.equal((await pedir("/mensajes", "token-malo")).status, 401);
  const r = await pedir("/mensajes", "CAJERO");
  assert.equal(r.status, 403);
  assert.match((await r.json()).mensaje, /permisos de Administrador/);
  const antes = process.env.GESTION_CAJA_URL;
  process.env.GESTION_CAJA_URL = "http://localhost:1";
  try {
    assert.equal((await pedir("/mensajes")).status, 503);
  } finally {
    process.env.GESTION_CAJA_URL = antes;
  }
});

test("el token del administrador se reenvia a Devoluciones (que tambien lo valida)", async () => {
  const sin = await fetch(`${url(servicios.devoluciones)}/api/integraciones/mensajes`);
  assert.equal(sin.status, 401); // sin token, Devoluciones no responde: por eso el monitor se lo reenvia
  const { fuentes } = await (await pedir("/mensajes")).json();
  assert.equal(fuentes.find((f) => f.origen === "devoluciones").ok, true);
});
