// Simulacion de los otros grupos (Contabilidad, Marketplace, Compras) y espejo de topicos. Pub/Sub SIMULADO: en esta prueba nunca se publica ni se lee
// nada real. BD real solo para las ventas y los reportes de prueba (se borran al terminar).
process.env.MARKETPLACE_VENTAS_SUBSCRIPTION = "projects/proyecto-prueba/subscriptions/sub-a1-prueba";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const publisher = require("../clients/pubsubPublisher");
const subscriber = require("../clients/pubsubSubscriber");
const simulacion = require("../services/simulacionService");
const espejo = require("../services/espejoTopicosService");
const { esVentaMarketplace, procesarVentas } = require("../jobs/marketplaceVentas");
const { interpretar: interpretarAcuse } = require("../services/acusesComprasService");
const rutas = require("../routes/simulacionRoutes");

// Los LECTORES reales de los otros servicios: lo que simulamos tiene que ser entendido por ellos tal cual
const servicios = "c:/Users/Dell G3/Documents/GitHub/A1TallerSis/Back/servicios";
const leeFacturacion = require(`${servicios}/facturacion/src/services/respuestasContabilidadService`).interpretar;
const leeDevoluciones = require(`${servicios}/devoluciones_reembolsos/src/services/respuestasContabilidadService`).interpretar;
const leeCaja = require(`${servicios}/gestion_caja/src/services/respuestasContabilidadService`).interpretar;

const A1 = "projects/project-a96e5fe1-5ba6-4698-a85/topics/ucb-sis323-sub-a1";
const MARCA = "sim-test";
let publicados; // lo que se "publico" por el publicador simulado
let caja, servidor, base, proveedores, ordenesRecibidas, respuestaProveedores;

const publicadorFalso = (falla = null) => ({
  topic: (nombre) => ({
    publishMessage: async (msg) => {
      if (falla) throw new Error(falla);
      publicados.push({ topico: nombre, json: msg.json, attributes: msg.attributes });
      return `msg-${publicados.length}`;
    },
  }),
});

test.before(async () => {
  caja = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if ((req.headers.authorization || "") === "Bearer ADMIN") return res.end(JSON.stringify({ ok: true, data: { administrador_id: "A", nombre: "Admin Prueba" } }));
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, mensaje: "no" }));
  });
  await new Promise((r) => caja.listen(0, r));
  process.env.ADMIN_VERIFICAR_URL = `http://localhost:${caja.address().port}`;

  proveedores = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    let cuerpo = "";
    req.on("data", (c) => { cuerpo += c; });
    req.on("end", () => {
      if (req.method === "POST") ordenesRecibidas.push(JSON.parse(cuerpo));
      res.statusCode = respuestaProveedores.status;
      res.end(JSON.stringify(respuestaProveedores.cuerpo));
    });
  });
  await new Promise((r) => proveedores.listen(0, r));
  process.env.PAGOS_PROVEEDORES_URL = `http://localhost:${proveedores.address().port}`;

  const app = express();
  app.use(express.json());
  app.use("/api/simulacion", require("../middlewares/requireAdministrador").requireAdministrador, rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/simulacion`;
});
test.beforeEach(() => {
  publicados = [];
  ordenesRecibidas = [];
  respuestaProveedores = { status: 201, cuerpo: { ok: true, data: { recibida: true } } };
  publisher.usarClienteDePrueba(publicadorFalso());
});
test.after(async () => {
  publisher.usarClienteDePrueba(null);
  subscriber.usarClienteDePrueba(null);
  espejo.usarClienteDePrueba(null);
  delete process.env.ADMIN_VERIFICAR_URL;
  delete process.env.PAGOS_PROVEEDORES_URL;
  servidor.close();
  caja.close();
  proveedores.close();
  await query(`DELETE FROM pagos.pubsub_verificaciones WHERE enviado_por = $1`, [MARCA]);
  await query(`DELETE FROM pagos.envios_compras WHERE reporte_id LIKE 'PV-2012-%'`);
  await pool.end();
});

// ---------------------------------------------------------------- contexto de cada vista
test("cada vista sabe de que grupo es y por que topicos viaja lo que se envia: simulado (de ese grupo hacia A1) y normal (de A1 hacia ese grupo)", () => {
  const c = simulacion.contexto("contabilidad");
  assert.deepEqual([c.grupo, c.sistema_origen], ["D", "CONTABILIDAD"]);
  assert.match(c.simulado.de.topico, /ucb-sis323-sub-d$/);
  assert.equal(c.simulado.a.topico, A1);
  assert.equal(c.normal.de.topico, A1);
  assert.match(c.normal.a.topico, /ucb-sis323-sub-d$/);
  const m = simulacion.contexto("marketplace");
  assert.deepEqual([m.grupo, m.sistema_origen], ["E", "MARKETPLACE_Y_VENTAS"]);
  assert.match(simulacion.contexto("compras").simulado.de.topico, /ucb-sis323-sub-c$/);
  assert.throws(() => simulacion.contexto("rrhh"), (e) => e.status === 404);
});

// ---------------------------------------------------------------- Contabilidad
test("Contabilidad ve sus documentos: pendientes (enviados sin respuesta, que se pueden resolver) y respondidos", async () => {
  const fake = async () => ({
    fuentes: [],
    mensajes: [
      { origen: "facturacion", id: "1", grupo: "D", tipo: "FACTURA_VENTA", referencia: "F-000010", fecha: "2026-11-01T10:00:00Z", estado: "Enviado", detalle: {} },
      { origen: "facturacion", id: "2", grupo: "D", tipo: "FACTURA_VENTA", referencia: "F-000011", fecha: "2026-11-01T11:00:00Z", estado: "Respondido", detalle: { resultado: "aceptado", numero_asiento: "16" } },
      { origen: "devoluciones", id: "3", grupo: "D", tipo: "NOTA_CREDITO", referencia: "NC-000002", fecha: "2026-11-02T11:00:00Z", estado: "Enviado", detalle: {} },
      { origen: "gestion_caja", id: "4", grupo: "D", tipo: "DIFERENCIA_CAJA", referencia: "DIF-7", fecha: "2026-11-02T12:00:00Z", estado: "Respondido", detalle: { motivo_rechazo: "cuenta inexistente" } },
      { origen: "pagos_proveedores", id: "5", grupo: "D", tipo: "LOTE_CIERRE", referencia: "LOTE-3", fecha: "2026-11-03T12:00:00Z", estado: "Enviado", detalle: {} },
      { origen: "facturacion", id: "6", grupo: "D", tipo: "FACTURA_VENTA", referencia: "F-000012", fecha: "2026-11-03T12:00:00Z", estado: "Error", detalle: {} },
      { origen: "gestion_pagos_compras", id: "7", grupo: "C", tipo: "PRODUCTOS_VENDIDOS", referencia: "PV-2026-11-01", fecha: "2026-11-03T12:00:00Z", estado: "Enviado", detalle: {} },
    ],
  });
  const d = await simulacion.documentosContabilidad({ reunirMensajes: fake, token: "T" });
  assert.deepEqual(d.pendientes.map((x) => x.referencia), ["F-000010", "NC-000002"]); // el lote no se responde por Pub/Sub y el grupo C no es de Contabilidad
  assert.deepEqual(d.pendientes.map((x) => x.tipo_nombre), ["Factura", "Nota de crédito"]);
  assert.deepEqual(d.respondidos.map((x) => [x.referencia, x.resultado, x.numero_asiento, x.motivo]), [["F-000011", "aceptado", "16", null], ["DIF-7", null, null, "cuenta inexistente"]]);
  assert.equal(d.sin_enviar, 1); // F-000012 en Error: todavia no salio
});

test("Contabilidad ACEPTA: publica UN resultado_documento al topico de A1 con su numero de asiento, y deja constancia en el log", async () => {
  const r = await simulacion.responderContabilidad({ referencia: "F-000123", resultado: "aceptado", numero_asiento: 55, enviado_por: MARCA });
  assert.equal(publicados.length, 1); // un solo mensaje
  const [p] = publicados;
  assert.equal(p.topico, A1);
  assert.deepEqual(
    [p.json.sistema_origen, p.json.tipo_mensaje, p.json.referencia_externa, p.json.estado, p.json.numero_asiento, p.json.motivo],
    ["CONTABILIDAD", "resultado_documento", "F-000123", "aceptado", "55", null]
  );
  assert.match(p.json.fecha_documento, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual([r.ok, r.message_id, r.resultado], [true, "msg-1", "aceptado"]);
  const { rows } = await query(`SELECT grupo, grupo_origen, ok, mensaje FROM pagos.pubsub_verificaciones WHERE id = $1`, [r.registro_id]);
  assert.deepEqual([rows[0].grupo, rows[0].grupo_origen, rows[0].ok], ["A1", "D", true]);
  assert.match(rows[0].mensaje, /Simulación Contabilidad.*F-000123 aceptado/);
});

test("Contabilidad RECHAZA: exige el motivo y lo manda; la nota de credito se 'registra' y el asiento se genera solo", async () => {
  await assert.rejects(simulacion.responderContabilidad({ referencia: "F-000124", resultado: "rechazado", enviado_enviado: MARCA }), (e) => e.status === 400 && /motivo/i.test(e.message));
  assert.equal(publicados.length, 0);
  await simulacion.responderContabilidad({ referencia: "F-000124", resultado: "rechazado", motivo: "cuenta contable inexistente", enviado_por: MARCA });
  assert.deepEqual([publicados[0].json.estado, publicados[0].json.motivo, publicados[0].json.numero_asiento], ["rechazado", "cuenta contable inexistente", null]);
  await simulacion.responderContabilidad({ referencia: "NC-000009", resultado: "aceptado", enviado_por: MARCA });
  assert.equal(publicados[1].json.estado, "registrado");
  assert.match(publicados[1].json.numero_asiento, /^\d+$/);
});

test("lo que simula Contabilidad lo ENTIENDEN los lectores reales de Facturacion, Devoluciones y Caja (cada uno toma solo lo suyo)", async () => {
  const mensaje = async (referencia, resultado, motivo) => {
    publicados.length = 0;
    await simulacion.responderContabilidad({ referencia, resultado, motivo, enviado_por: MARCA });
    return JSON.stringify(publicados[0].json);
  };
  const factura = await mensaje("F-000200", "aceptado");
  assert.deepEqual([leeFacturacion(factura).facturaNumero, leeFacturacion(factura).resultado, leeFacturacion(factura).tipo], ["F-000200", "aceptado", "venta"]);
  assert.equal(leeDevoluciones(factura), null);
  assert.equal(leeCaja(factura), null);
  const anulacion = await mensaje("ANU-F-000200", "rechazado", "la venta original no existe");
  assert.deepEqual([leeFacturacion(anulacion).tipo, leeFacturacion(anulacion).motivo], ["anulacion", "la venta original no existe"]);
  const nota = await mensaje("NC-000031", "aceptado");
  assert.deepEqual([leeDevoluciones(nota).notaNumero, leeDevoluciones(nota).resultado], ["NC-000031", "registrado"]);
  assert.equal(leeFacturacion(nota), null);
  const dif = await mensaje("DIF-45", "rechazado", "monto no cuadra");
  assert.deepEqual([leeCaja(dif).diferenciaId, leeCaja(dif).estado, leeCaja(dif).motivo], [45, "Rechazado", "monto no cuadra"]);
  assert.equal(leeCaja(await mensaje("DIF-46", "aceptado")).estado, "Confirmado");
});

test("referencia o resultado invalidos son 400 y no se publica nada; si Pub/Sub falla el error queda en el log y es 502", async () => {
  for (const referencia of ["", "F-abc", "OC-12", "NC-", "DIF-x", "ANU-NC-1"]) {
    await assert.rejects(simulacion.responderContabilidad({ referencia, resultado: "aceptado" }), (e) => e.status === 400, referencia);
  }
  await assert.rejects(simulacion.responderContabilidad({ referencia: "F-000001", resultado: "quizas" }), (e) => e.status === 400);
  assert.equal(publicados.length, 0);
  publisher.usarClienteDePrueba(publicadorFalso("sin red"));
  await assert.rejects(simulacion.responderContabilidad({ referencia: "F-000001", resultado: "aceptado", enviado_por: MARCA }), (e) => e.status === 502 && /sin red/.test(e.message));
  const { rows } = await query(`SELECT ok, error FROM pagos.pubsub_verificaciones WHERE enviado_por = $1 AND ok = false ORDER BY id DESC LIMIT 1`, [MARCA]);
  assert.match(rows[0].error, /sin red/);
});

// ---------------------------------------------------------------- Marketplace
test("Marketplace: el catalogo tiene productos con precio", () => {
  const c = simulacion.listarProductosMarketplace();
  assert.ok(c.length >= 10);
  assert.ok(c.every((p) => p.sku && p.descripcion && p.precio > 0));
  assert.equal(new Set(c.map((p) => p.sku)).size, c.length);
});

test("Marketplace manda una venta: UN mensaje a A1, el total lo calcula el servidor y el job de ventas la reconoce como suya", async () => {
  let leido = 0;
  const r = await simulacion.enviarVentaMarketplace({
    items: [{ sku: "ARR-001", cantidad: 2 }, { sku: "LEC-005", cantidad: 3 }, { sku: "DET-012", cantidad: 1 }],
    nit: "1234567890", razon_social: "Cliente Simulado", email: "cliente@correo.com", metodo_pago: "QR", enviado_por: MARCA, alPublicar: () => { leido += 1; },
  });
  assert.equal(publicados.length, 1);
  const { topico, json } = publicados[0];
  assert.equal(topico, A1);
  assert.equal(json.total, 233.5); // 2 x 95,00 + 3 x 7,00 + 22,50
  assert.deepEqual([json.sistema_origen, json.nit, json.tipoDocumento, json.metodoPago, json.items.length], ["MARKETPLACE_Y_VENTAS", "1234567890", "NIT", "QR", 3]);
  assert.deepEqual(json.items[0], { sku: "ARR-001", descripcion: "Arroz Grano de Oro 10 kg", cantidad: 2, precioUnitario: 95 });
  assert.match(json.ordenId, /^MKT-SIM-[0-9A-Z]+$/);
  assert.deepEqual([r.orden_id, r.total, r.items, leido], [json.ordenId, 233.5, 3, 1]);
  assert.equal(esVentaMarketplace(JSON.stringify(json)), true);
  // el total que manda es la suma exacta de sus items: lo que valida recibirVenta
  assert.equal(Math.round(json.items.reduce((a, it) => a + it.cantidad * it.precioUnitario, 0) * 100), Math.round(json.total * 100));
});

test("Marketplace: sin productos, producto falso, repetido, cantidad mala, NIT o correo invalido: 400 y no se publica nada", async () => {
  const ok = { items: [{ sku: "ARR-001", cantidad: 1 }], nit: "1234567890", razon_social: "Cliente" };
  const casos = [
    { ...ok, items: [] }, { ...ok, items: undefined }, { ...ok, items: [{ sku: "XXX-999", cantidad: 1 }] },
    { ...ok, items: [{ sku: "ARR-001", cantidad: 1 }, { sku: "ARR-001", cantidad: 2 }] },
    { ...ok, items: [{ sku: "ARR-001", cantidad: 0 }] }, { ...ok, items: [{ sku: "ARR-001", cantidad: 1.5 }] }, { ...ok, items: [{ sku: "ARR-001", cantidad: 51 }] },
    { ...ok, nit: "12" }, { ...ok, nit: "" }, { ...ok, razon_social: "  " }, { ...ok, email: "no-es-correo" }, { ...ok, metodo_pago: "Cheque" },
  ];
  for (const c of casos) await assert.rejects(simulacion.enviarVentaMarketplace(c), (e) => e.status === 400, JSON.stringify(c).slice(0, 80));
  assert.equal(publicados.length, 0);
  await simulacion.enviarVentaMarketplace({ ...ok, enviado_por: MARCA }); // el caso base SI pasa
  assert.equal(publicados.length, 1);
});

test("el job de ventas del Marketplace ya NO se come los mensajes de otros grupos (suscripcion compartida): los libera sin confirmar", async () => {
  const resultadoContabilidad = JSON.stringify({ sistema_origen: "CONTABILIDAD", tipo_mensaje: "resultado_documento", referencia_externa: "F-000001", estado: "aceptado" });
  const acuse = JSON.stringify({ origen: "compras", reporte_id: "PV-2026-11-01" });
  assert.equal(esVentaMarketplace(resultadoContabilidad), false);
  assert.equal(esVentaMarketplace(acuse), false);
  assert.equal(esVentaMarketplace("hola"), false);
  assert.equal(esVentaMarketplace("[1,2]"), false);
  assert.equal(esVentaMarketplace(JSON.stringify({ ordenId: "X" })), true);
  assert.equal(esVentaMarketplace(JSON.stringify({ sistema_origen: "MARKETPLACE_Y_VENTAS" })), true);

  const falsa = { confirmados: [], liberados: [] };
  falsa.pull = async () => [{ receivedMessages: [resultadoContabilidad, acuse, "hola"].map((t, i) => ({ ackId: `ack-${i}`, message: { messageId: `m${i}`, data: Buffer.from(t), attributes: {}, publishTime: { seconds: 1760900000, nanos: 0 } } })) }];
  falsa.acknowledge = async ({ ackIds }) => falsa.confirmados.push(...ackIds);
  falsa.modifyAckDeadline = async ({ ackIds, ackDeadlineSeconds }) => falsa.liberados.push(...ackIds.map((id) => [id, ackDeadlineSeconds]));
  falsa.close = async () => {};
  subscriber.usarClienteDePrueba(falsa);
  const r = await procesarVentas();
  assert.deepEqual(r, []);
  assert.deepEqual(falsa.confirmados, []); // NADA se confirmo: ninguno era una venta
  assert.deepEqual(falsa.liberados, [["ack-0", 0], ["ack-1", 0], ["ack-2", 0]]); // y se devolvieron al instante a la suscripcion
});

// ---------------------------------------------------------------- Compras
test("Compras acusa un reporte nuestro: el mensaje lo reconoce el job de acuses; los reportes inexistentes, ya recibidos o sin enviar se rechazan", async () => {
  await query(`INSERT INTO pagos.envios_compras (fecha, reporte_id, estado, intentos, payload) VALUES ('2012-03-01', 'PV-2012-03-01', 'Enviado', 1, '{}'), ('2012-03-02', 'PV-2012-03-02', 'Recibido', 1, '{}'), ('2012-03-03', 'PV-2012-03-03', 'Error', 1, '{}')`);
  const lista = (await simulacion.reportesCompras()).filter((r) => r.reporte_id.startsWith("PV-2012-"));
  assert.deepEqual(lista.map((r) => [r.reporte_id, r.estado, r.puede_acusar]).sort(), [["PV-2012-03-01", "Enviado", true], ["PV-2012-03-02", "Recibido", false], ["PV-2012-03-03", "Error", false]]);

  let leido = 0;
  const r = await simulacion.acusarCompras({ reporte_id: "PV-2012-03-01", enviado_por: MARCA, alPublicar: () => { leido += 1; } });
  assert.equal(publicados.length, 1);
  assert.equal(publicados[0].topico, A1);
  assert.deepEqual([publicados[0].json.origen, publicados[0].json.reporte_id], ["compras", "PV-2012-03-01"]);
  assert.deepEqual(interpretarAcuse(JSON.stringify(publicados[0].json)), { reporteId: "PV-2012-03-01", fecha: "2012-03-01" }); // el lector real lo entiende
  assert.deepEqual([r.reporte_id, leido], ["PV-2012-03-01", 1]);

  await assert.rejects(simulacion.acusarCompras({ reporte_id: "PV-2012-03-02" }), (e) => e.status === 409 && /ya confirm/.test(e.message));
  await assert.rejects(simulacion.acusarCompras({ reporte_id: "PV-2012-03-03" }), (e) => e.status === 409 && /todavía no salió/.test(e.message));
  await assert.rejects(simulacion.acusarCompras({ reporte_id: "PV-2012-03-09" }), (e) => e.status === 404);
  await assert.rejects(simulacion.acusarCompras({ reporte_id: "OC-1" }), (e) => e.status === 400);
  assert.equal(publicados.length, 1);
});

test("Compras manda una orden de pago por Pub/Sub al topico de A1, con el sobre de siempre y el formato que Pagos a Proveedores lee y valida", async () => {
  const leeProveedores = require(`${servicios}/pagos_proveedores/src/services/ordenesComprasPubSubService`).interpretar;
  const r = await simulacion.enviarOrdenCompras({ proveedor_id: "andina", monto: 3450.5, concepto: "Compra de abarrotes", dias_vencimiento: 20, enviado_por: MARCA });
  assert.equal(publicados.length, 1);
  const { topico, json, attributes } = publicados[0];
  assert.equal(topico, A1);
  assert.deepEqual([json.sistema_origen, json.tipo_operacion, json.referencia_externa], ["GESTION_DE_COMPRAS_Y_PROVEEDORES", "orden_pago", r.numero]);
  assert.match(json.fecha_documento, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual([attributes.tipo, attributes.grupo, attributes.referencia_externa], ["ORDEN_PAGO", "C", r.numero]);
  const o = json.datos;
  assert.match(o.numero, /^OP-SIM-/);
  assert.match(o.ordenCompraId, /^OC-SIM-/);
  assert.deepEqual([o.monto, o.concepto, o.proveedor.razonSocial, o.proveedor.banco], [3450.5, "Compra de abarrotes", "Distribuidora Andina S.R.L.", "Banco Unión"]);
  assert.ok(o.proveedor.nit && o.proveedor.cuentaBancaria);
  assert.match(o.fechaVencimiento, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual([r.numero, r.monto, r.ok], [o.numero, 3450.5, true]);
  assert.ok(leeProveedores(JSON.stringify(json)), "Pagos a Proveedores reconoce el mensaje como una orden de pago");
  // los otros servicios que comparten la suscripcion NO se lo llevan
  assert.equal(leeFacturacion(JSON.stringify(json)), null);
  assert.equal(esVentaMarketplace(JSON.stringify(json)), false);

  // y queda en el registro unico de Pub/Sub: quien lo mando, hacia donde, cuando
  const { rows } = await query(`SELECT direccion, servicio, tipo, referencia, grupo_origen, grupo, ok, message_id, creado_en FROM pagos.pubsub_verificaciones WHERE referencia = $1`, [r.numero]);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].direccion, rows[0].servicio, rows[0].tipo, rows[0].grupo_origen, rows[0].grupo, rows[0].ok], ["ENVIADO", "gestion_pagos", "ORDEN_PAGO", "C", "A1", true]);
  assert.equal(rows[0].message_id, r.message_id);
  assert.ok(rows[0].creado_en);

  for (const mala of [{ proveedor_id: "x", monto: 10 }, { proveedor_id: "sur", monto: 0 }, { proveedor_id: "sur", monto: -1 }, { proveedor_id: "sur", monto: 10.123 }, { proveedor_id: "sur", monto: "abc" }, { proveedor_id: "sur", monto: 10, dias_vencimiento: 0 }]) {
    await assert.rejects(simulacion.enviarOrdenCompras(mala), (e) => e.status === 400, JSON.stringify(mala));
  }
  assert.equal(publicados.length, 1); // las invalidas no publican nada
  publisher.usarClienteDePrueba(publicadorFalso("PERMISSION_DENIED"));
  await assert.rejects(simulacion.enviarOrdenCompras({ proveedor_id: "sur", monto: 10 }), (e) => e.status === 502);
});

// ---------------------------------------------------------------- Espejo de topicos
function clienteEspejoFalso({ crear = "ok" } = {}) {
  const f = { creadas: [], borradas: [] };
  f.topic = (nombre) => ({
    createSubscription: async (sub, opciones) => {
      if (crear === "existe") throw Object.assign(new Error("6 ALREADY_EXISTS"), { code: 6 });
      if (crear === "sin_permiso") throw Object.assign(new Error("7 PERMISSION_DENIED: not authorized"), { code: 7 });
      f.creadas.push({ topico: nombre, sub, opciones });
    },
  });
  f.subscription = (sub) => ({ delete: async () => { if (crear === "no_existe") throw Object.assign(new Error("5 NOT_FOUND"), { code: 5 }); f.borradas.push(sub); } });
  return f;
}

test("espejo: se activa solo por pedido, sobre el topico elegido, con retencion minima (10 min) y caducidad (1 dia) para no acumular mensajes", async () => {
  const f = clienteEspejoFalso();
  espejo.usarClienteDePrueba(f);
  const r = await espejo.activar("F");
  assert.deepEqual([r.grupo, r.activo, r.nuevo, r.suscripcion], ["F", true, true, "ucb-sis323-a1-espejo-f"]);
  assert.match(f.creadas[0].topico, /topics\/ucb-sis323-sub-f$/);
  assert.deepEqual(f.creadas[0].opciones, { ackDeadlineSeconds: 10, messageRetentionDuration: { seconds: 600 }, expirationPolicy: { ttl: { seconds: 86400 } } });
  espejo.usarClienteDePrueba(clienteEspejoFalso({ crear: "existe" }));
  assert.equal((await espejo.activar("F")).nuevo, false); // ya estaba: no es un error
  espejo.usarClienteDePrueba(clienteEspejoFalso({ crear: "sin_permiso" }));
  await assert.rejects(espejo.activar("F"), (e) => e.status === 403 && /Pub\/Sub Editor/.test(e.message)); // mensaje claro de a quien pedirle permiso
  await assert.rejects(espejo.activar("Z"), (e) => e.status === 400);
});

test("espejo: lee lo que llego al topico (hasta 20), lo confirma para vaciar la suscripcion y entiende JSON o texto; sin espejo activo no es un error", async () => {
  const falsa = { confirmados: [], pedidos: [] };
  falsa.pull = async (peticion) => {
    falsa.pedidos.push(peticion);
    return [{ receivedMessages: [
      { ackId: "a1", message: { messageId: "m1", data: Buffer.from(JSON.stringify({ sistema_origen: "RRHH", tipo_operacion: "planilla" })), attributes: { x: "1" }, publishTime: { seconds: 1760900000, nanos: 0 } } },
      { ackId: "a2", message: { messageId: "m2", data: Buffer.from("hola desde A1"), attributes: {}, publishTime: { seconds: 1760900060, nanos: 0 } } },
    ] }];
  };
  falsa.acknowledge = async ({ ackIds }) => falsa.confirmados.push(...ackIds);
  falsa.close = async () => {};
  subscriber.usarClienteDePrueba(falsa);
  const r = await espejo.leer("F");
  assert.equal(falsa.pedidos[0].maxMessages, 20);
  assert.match(falsa.pedidos[0].subscription, /subscriptions\/ucb-sis323-a1-espejo-f$/);
  assert.deepEqual(falsa.confirmados, ["a1", "a2"]); // se vacia: no se acumula
  assert.deepEqual(r.mensajes.map((m) => [m.message_id, m.json ? m.json.sistema_origen : null, m.texto.length > 0]), [["m1", "RRHH", true], ["m2", null, true]]);
  assert.equal(r.mensajes[1].texto, "hola desde A1");

  subscriber.usarClienteDePrueba({ pull: async () => { throw Object.assign(new Error("5 NOT_FOUND: Resource not found"), { code: 5 }); }, close: async () => {} });
  assert.deepEqual(await espejo.leer("F"), { grupo: "F", topico: r.topico, activo: false, mensajes: [] });
});

test("espejo: se desactiva (se borra la suscripcion); borrar uno que no existe tampoco es error", async () => {
  const f = clienteEspejoFalso();
  espejo.usarClienteDePrueba(f);
  assert.deepEqual(await espejo.desactivar("F"), { grupo: "F", activo: false, eliminado: true });
  assert.deepEqual(f.borradas, ["ucb-sis323-a1-espejo-f"]);
  espejo.usarClienteDePrueba(clienteEspejoFalso({ crear: "no_existe" }));
  assert.equal((await espejo.desactivar("F")).eliminado, false);
});

// ---------------------------------------------------------------- HTTP: solo administrador
test("por HTTP: todo es solo del administrador (401 sin token) y con token publica UN mensaje", async () => {
  assert.equal((await fetch(`${base}/vistas/contabilidad`)).status, 401);
  assert.equal((await fetch(`${base}/contabilidad/responder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
  assert.equal(publicados.length, 0);

  const cab = { "Content-Type": "application/json", Authorization: "Bearer ADMIN" };
  const v = await (await fetch(`${base}/vistas/marketplace`, { headers: cab })).json();
  assert.equal(v.data.grupo, "E");
  const r = await fetch(`${base}/contabilidad/responder`, { method: "POST", headers: cab, body: JSON.stringify({ referencia: "F-000500", resultado: "aceptado" }) });
  assert.equal(r.status, 201);
  assert.equal(publicados.length, 1);
  const { rows } = await query(`SELECT enviado_por FROM pagos.pubsub_verificaciones WHERE id = $1`, [(await r.json()).data.registro_id]);
  assert.equal(rows[0].enviado_por, "Admin Prueba"); // queda quien lo hizo
  await query(`DELETE FROM pagos.pubsub_verificaciones WHERE enviado_por = 'Admin Prueba' AND mensaje LIKE '%F-000500%'`);
  assert.equal((await fetch(`${base}/vistas/rrhh`, { headers: cab })).status, 404);
  const malo = await fetch(`${base}/marketplace/ventas`, { method: "POST", headers: cab, body: JSON.stringify({ items: [] }) });
  assert.equal(malo.status, 400);
  assert.equal(publicados.length, 1);
  const productos = await (await fetch(`${base}/marketplace/productos`, { headers: cab })).json();
  assert.ok(productos.data.length >= 10);
});

// ---------------------------------------------------------------- Un solo mensaje por documento y detalle de la bandeja
test("Contabilidad responde UNA sola vez por documento: dos clics a la vez publican un solo mensaje y los siguientes son 409", async () => {
  const ref = `F-${String(Date.now()).slice(-7)}`;
  const r = await Promise.allSettled([
    simulacion.responderContabilidad({ referencia: ref, resultado: "aceptado", enviado_por: MARCA }),
    simulacion.responderContabilidad({ referencia: ref, resultado: "aceptado", enviado_por: MARCA }),
    simulacion.responderContabilidad({ referencia: ref, resultado: "rechazado", motivo: "No coincide el monto", enviado_por: MARCA }),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.deepEqual(r.filter((x) => x.status === "rejected").map((x) => x.reason.status), [409, 409]);
  assert.equal(publicados.filter((p) => p.json.referencia_externa === ref).length, 1, "un solo mensaje hacia A1");

  // otro intento un instante despues (A1 todavia lo procesa): tampoco se publica nada mas
  await assert.rejects(simulacion.responderContabilidad({ referencia: ref, resultado: "aceptado", enviado_por: MARCA }), (e) => e.status === 409 && /hace instantes/.test(e.message));
  assert.equal(publicados.filter((p) => p.json.referencia_externa === ref).length, 1);

  // y si no salio (Pub/Sub fallo) se puede volver a intentar: el candado no queda pegado
  const otra = `F-${String(Date.now() + 1).slice(-7)}`;
  publisher.usarClienteDePrueba(publicadorFalso("PERMISSION_DENIED"));
  await assert.rejects(simulacion.responderContabilidad({ referencia: otra, resultado: "aceptado", enviado_por: MARCA }), (e) => e.status === 502);
  publisher.usarClienteDePrueba(publicadorFalso());
  const ok = await simulacion.responderContabilidad({ referencia: otra, resultado: "aceptado", enviado_por: MARCA });
  assert.equal(ok.ok, true);
});

test("el detalle de un documento de la bandeja trae lo que A1 envio; 404 si Contabilidad no lo tiene", async () => {
  const reunirMensajes = async () => ({
    mensajes: [{ grupo: "D", referencia: "DIF-7", tipo: "DIFERENCIA_CAJA", estado: "Enviado", fecha: "2026-11-22T10:00:00Z", origen: "gestion_caja", message_id: "m-9", intentos: 1, detalle: { turno_id: 3, monto: 12.5 }, datos: { tipo_operacion: "diferencia_caja", monto: 12.5 } }],
  });
  const d = await simulacion.detalleDocumentoContabilidad({ referencia: "DIF-7", reunirMensajes });
  assert.deepEqual([d.referencia, d.tipo_nombre, d.servicio_origen, d.message_id, d.factura], ["DIF-7", "Diferencia de caja", "gestion_caja", "m-9", null]);
  assert.equal(d.extra.monto, 12.5);
  await assert.rejects(simulacion.detalleDocumentoContabilidad({ referencia: "DIF-99", reunirMensajes }), (e) => e.status === 404);
  await assert.rejects(simulacion.detalleDocumentoContabilidad({ referencia: "", reunirMensajes }), (e) => e.status === 400);
});

test("al publicar la respuesta de Contabilidad se despierta al servicio dueño del documento (facturas, notas de credito, diferencias) para que A1 la registre al momento", () => {
  const llamadas = [];
  const fetchOriginal = global.fetch;
  const timeoutOriginal = global.setTimeout;
  global.fetch = (url, op) => { llamadas.push({ url, auth: op.headers.Authorization }); return Promise.resolve({}); };
  global.setTimeout = (fn) => { fn(); return { unref() {} }; };
  try {
    simulacion.despertarLectorContabilidad("F-000123", "TK");
    simulacion.despertarLectorContabilidad("ANU-F-000123", "TK");
    simulacion.despertarLectorContabilidad("NC-000004", "TK");
    simulacion.despertarLectorContabilidad("DIF-12", "TK");
    simulacion.despertarLectorContabilidad("LOTE-1", "TK"); // sin dueño conocido: no llama a nadie
    simulacion.despertarLectorContabilidad("F-000123", null); // sin token no se puede
  } finally {
    global.fetch = fetchOriginal;
    global.setTimeout = timeoutOriginal;
  }
  const por = (parte) => llamadas.filter((l) => l.url.includes(parte));
  assert.equal(por("/api/facturas/respuestas-contabilidad/procesar").length, 6); // factura y anulacion: 3 lecturas cada una
  assert.equal(por("/api/integraciones/respuestas-contabilidad/procesar").length, 3);
  assert.equal(por("/api/caja/diferencias/respuestas-contabilidad/procesar").length, 3);
  assert.equal(llamadas.length, 12);
  assert.ok(llamadas.every((l) => l.auth === "Bearer TK"));
});
