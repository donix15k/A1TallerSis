// Pantalla "Pagos a proveedores": lista las ordenes de Compras y paga UNA orden registrando su egreso. BD real (ordenes de prueba que se borran);
// la validacion de administrador es un Gestion de Caja local (stub HTTP). No se confirma nada a Compras.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const { requireAdministrador } = require("../middlewares/requireAdministrador");
const rutas = require("../routes/pagosProveedoresAdminRoutes");
const publicador = require("../clients/comprasPagoPublisher");

const TOPICO = "projects/project-test-12345/topics/ucb-sis323-sub-c";
const publicados = []; // lo que se "publica" en Pub/Sub FALSO: nunca se publica de verdad
let falla = null;

let caja, servidor, base;
let flujoAntes; // pagar una orden suma al contador EN_CURSO del dia (flujo de caja): se deja como estaba
const P = "TPPA-";

async function orden(n, { monto = 250, hace = 1 } = {}) {
  await pool.query(
    `INSERT INTO proveedores.ordenes_pago (numero, orden_compra_id, proveedor_nit, proveedor_razon_social, proveedor_cuenta_bancaria, proveedor_banco, monto, estado, creado_en)
     VALUES ($1, $2, '1', 'Proveedor TPPA', '10', 'Banco', $3, 'PENDIENTE', now() - make_interval(days => $4))`,
    [`${P}${n}`, `OC-${P}${n}`, monto, hace]
  );
}
const limpiar = async () => {
  await pool.query(`DELETE FROM proveedores.egresos WHERE orden_pago_id IN (SELECT id FROM proveedores.ordenes_pago WHERE numero LIKE '${P}%')`);
  await pool.query(`DELETE FROM proveedores.ordenes_pago WHERE numero LIKE '${P}%'`);
};
const llamar = (metodo, ruta, cuerpo, token = "ADMIN") =>
  fetch(`${base}${ruta}`, { method: metodo, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

test.before(async () => {
  publicador.usarTopicoDePrueba(TOPICO);
  publicador.usarClienteDePrueba({
    topic: (nombre) => ({
      publishMessage: async (m) => {
        if (falla) throw falla;
        publicados.push({ ...m, topico: nombre });
        return `fake-msg-${publicados.length}`;
      },
    }),
  });
  await limpiar();
  flujoAntes = (await pool.query(`SELECT total_egresos FROM proveedores.lotes_cierre_diario WHERE fecha = (now() AT TIME ZONE 'America/La_Paz')::date AND estado = 'EN_CURSO'`)).rows[0] ?? null;
  caja = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if ((req.headers.authorization || "") === "Bearer ADMIN") return res.end(JSON.stringify({ ok: true, data: { administrador_id: "A", nombre: "Admin Prueba" } }));
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, mensaje: "no" }));
  });
  await new Promise((r) => caja.listen(0, r));
  process.env.ADMIN_VERIFICAR_URL = `http://localhost:${caja.address().port}`;
  const app = express();
  app.use(express.json());
  app.use("/api/pagos-proveedores", requireAdministrador, rutas);
  app.use(errorHandler);
  servidor = app.listen(0);
  await new Promise((r) => servidor.once("listening", r));
  base = `http://localhost:${servidor.address().port}`;
  await orden("A", { monto: 250 });
  await orden("VENCIDA", { monto: 900, hace: 20 });
});
test.after(async () => {
  publicador.usarTopicoDePrueba(undefined);
  publicador.usarClienteDePrueba(null);
  await limpiar();
  const hoy = `(now() AT TIME ZONE 'America/La_Paz')::date`;
  if (flujoAntes) await pool.query(`UPDATE proveedores.lotes_cierre_diario SET total_egresos = $1 WHERE fecha = ${hoy} AND estado = 'EN_CURSO'`, [flujoAntes.total_egresos]);
  else await pool.query(`DELETE FROM proveedores.lotes_cierre_diario WHERE fecha = ${hoy} AND estado = 'EN_CURSO'`);
  servidor.closeAllConnections();
  caja.closeAllConnections();
  await new Promise((r) => servidor.close(r));
  await new Promise((r) => caja.close(r));
  await pool.end();
});

test("solo el administrador: sin token o con uno invalido responde 401", async () => {
  assert.equal((await llamar("GET", "/api/pagos-proveedores/ordenes", null, "X")).status, 401);
  assert.equal((await llamar("POST", `/api/pagos-proveedores/ordenes/${P}A/pagar`, { metodo: "TRANSFERENCIA" }, "X")).status, 401);
});

test("lista las ordenes con su proveedor y marca como vencida la pendiente con mas de 15 dias", async () => {
  const r = await llamar("GET", "/api/pagos-proveedores/ordenes?estado=PENDIENTE");
  assert.equal(r.status, 200);
  assert.deepEqual(r.cuerpo.metodos, ["TRANSFERENCIA", "CHEQUE", "EFECTIVO"]);
  const mias = r.cuerpo.data.filter((o) => o.numero.startsWith(P));
  assert.equal(mias.length, 2);
  assert.equal(mias.find((o) => o.numero === `${P}A`).vencida, false);
  assert.equal(mias.find((o) => o.numero === `${P}VENCIDA`).vencida, true);
  assert.equal(mias[0].proveedor, "Proveedor TPPA");
});

test("pagar una orden registra el egreso por su monto, la deja LIQUIDADA con el administrador y no se puede pagar dos veces", async () => {
  const r = await llamar("POST", `/api/pagos-proveedores/ordenes/${P}A/pagar`, { metodo: "TRANSFERENCIA", descripcion: "Pago de prueba" });
  assert.equal(r.status, 201);
  assert.equal(r.cuerpo.data.orden.estado, "LIQUIDADA");
  assert.equal(Number(r.cuerpo.data.egreso.monto), 250);
  assert.equal(r.cuerpo.data.egreso.registrado_por, "Admin Prueba");
  assert.equal(r.cuerpo.data.egreso.metodo, "TRANSFERENCIA");

  const pagadas = (await llamar("GET", "/api/pagos-proveedores/ordenes?estado=LIQUIDADA")).cuerpo.data.filter((o) => o.numero === `${P}A`);
  assert.equal(pagadas.length, 1);
  assert.equal(pagadas[0].liquidada_por, "Admin Prueba");

  assert.equal((await llamar("POST", `/api/pagos-proveedores/ordenes/${P}A/pagar`, { metodo: "TRANSFERENCIA" })).status, 409);
});

test("rechaza un metodo no permitido y una orden que no existe, sin liquidar nada", async () => {
  assert.equal((await llamar("POST", `/api/pagos-proveedores/ordenes/${P}VENCIDA/pagar`, { metodo: "BITCOIN" })).status, 400);
  assert.equal((await llamar("POST", "/api/pagos-proveedores/ordenes/NO-EXISTE/pagar", { metodo: "EFECTIVO" })).status, 404);
  const { rows } = await pool.query(`SELECT estado FROM proveedores.ordenes_pago WHERE numero = $1`, [`${P}VENCIDA`]);
  assert.equal(rows[0].estado, "PENDIENTE");
});

test("al pagar se confirma a Compras por Pub/Sub con el mismo sobre de las ordenes de pago: orden, proveedor, monto, metodo y quien pago", async () => {
  await orden("B", { monto: 410.5 });
  publicados.length = 0;
  const r = await llamar("POST", `/api/pagos-proveedores/ordenes/${P}B/pagar`, { metodo: "CHEQUE", descripcion: "Cheque 4521" });
  assert.equal(r.status, 201);
  assert.equal(r.cuerpo.data.confirmacion_compras.enviada, true);

  assert.equal(publicados.length, 1);
  const { json, attributes, topico } = publicados[0];
  assert.match(topico, /ucb-sis323-sub-c$/);
  assert.deepEqual(Object.keys(json), ["sistema_origen", "tipo_operacion", "referencia_externa", "fecha_documento", "datos"]);
  assert.equal(json.sistema_origen, "GESTION_DE_PAGOS_Y_FACTURACION");
  assert.equal(json.tipo_operacion, "pago_proveedor_confirmado");
  assert.equal(json.referencia_externa, `${P}B`);
  assert.match(json.fecha_documento, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(json.datos.ordenCompraId, `OC-${P}B`);
  assert.equal(json.datos.estado, "pagado");
  assert.equal(json.datos.monto, 410.5);
  assert.equal(json.datos.metodoPago, "CHEQUE");
  assert.equal(json.datos.descripcion, "Cheque 4521");
  assert.equal(json.datos.pagadoPor, "Admin Prueba");
  assert.deepEqual(json.datos.proveedor, { nit: "1", razonSocial: "Proveedor TPPA", banco: "Banco", cuentaBancaria: "10" });
  assert.equal(attributes.idempotency_key, `pago-${P}B`);

  const lista = (await llamar("GET", "/api/pagos-proveedores/ordenes?estado=LIQUIDADA")).cuerpo.data.find((o) => o.numero === `${P}B`);
  assert.equal(lista.confirmacion_compras, "Enviado");
});

test("si Pub/Sub falla el pago igual queda hecho, la confirmacion queda en Error y se puede reenviar (una sola vez enviada)", async () => {
  await orden("C", { monto: 99 });
  falla = Object.assign(new Error("sin red"), { code: 14 });
  const r = await llamar("POST", `/api/pagos-proveedores/ordenes/${P}C/pagar`, { metodo: "TRANSFERENCIA" });
  assert.equal(r.status, 201);
  assert.equal(r.cuerpo.data.orden.estado, "LIQUIDADA");
  assert.equal(r.cuerpo.data.confirmacion_compras.estado, "Error");
  const lista = (await llamar("GET", "/api/pagos-proveedores/ordenes?estado=LIQUIDADA")).cuerpo.data.find((o) => o.numero === `${P}C`);
  assert.equal(lista.confirmacion_compras, "Error");

  falla = null;
  publicados.length = 0;
  const re = await llamar("POST", `/api/pagos-proveedores/ordenes/${P}C/reenviar-confirmacion`);
  assert.equal(re.status, 200);
  assert.equal(publicados.length, 1);
  const otra = await llamar("POST", `/api/pagos-proveedores/ordenes/${P}C/reenviar-confirmacion`);
  assert.equal(otra.cuerpo.data.confirmacion_compras.yaEnviada, true);
  assert.equal(publicados.length, 1, "una orden se confirma una sola vez");
});

test("reenviar la confirmacion de una orden que todavia no se pago responde error y no publica nada", async () => {
  publicados.length = 0;
  const r = await llamar("POST", `/api/pagos-proveedores/ordenes/${P}VENCIDA/reenviar-confirmacion`);
  assert.equal(r.status, 502);
  assert.equal(publicados.length, 0);
});
