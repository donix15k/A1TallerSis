// Tiendita del cajero: los productos de la venta se validan con el catalogo, se guardan y salen en la factura (modelo y PDF), junto con el
// cajero, la caja y, si la venta se anulo, el supervisor que lo autorizo. BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { registrarPagoSimple } = require("../services/pagoSimpleService");
const { registrarPagoMixto } = require("../services/pagoMixtoService");
const { construirFacturaDigital } = require("../services/facturaDigitalService");
const { construirModeloComprobante } = require("../services/comprobanteModelo");
const { generarFacturaPdfBuffer } = require("../services/facturaPdfService");
const repo = require("../data/pagosRepo");
const { query } = require("../config/db");

const ids = [];
test.after(async () => {
  for (const id of ids) await repo.eliminarVentaRegistrada(id);
});

const ARROZ_Y_ACEITE = [{ sku: "ARR-001", cantidad: 2 }, { sku: "ACE-002", cantidad: 1 }]; // 2 x 95 + 15 = 205

test("una venta con productos guarda cada linea con el precio del catalogo y sale en la factura", async () => {
  const r = await registrarPagoSimple({ metodo: "Efectivo", monto: 205, caja_id: "CAJA-02", cajero_nombre: "Rosa Mamani", items: ARROZ_Y_ACEITE });
  ids.push(r.pago.id_transaccion);

  const guardados = await repo.listarItemsVenta(r.pago.id_transaccion);
  assert.deepEqual(guardados.map((i) => [i.sku, i.cantidad, i.precio_unitario, i.subtotal]), [["ARR-001", 2, 95, 190], ["ACE-002", 1, 15, 15]]);

  const factura = await construirFacturaDigital(r.pago.id_transaccion);
  assert.equal(factura.productos.length, 2);
  assert.equal(factura.items, undefined, "no debe parecer una venta del Marketplace");
  const modelo = construirModeloComprobante(factura);
  assert.deepEqual(modelo.productos.encabezado, ["Producto", "Subtotal Bs."]);
  assert.equal(modelo.productos.filas[0][1], "190.00");
  assert.match(modelo.productos.filas[0][0], /2 x Arroz Grano de Oro 10 kg/);
  assert.equal(modelo.atendidoPor, "Atendido por: Rosa Mamani · Caja N° CAJA-02"); // cajero y caja
  assert.deepEqual(modelo.detalle.encabezado, ["Método de pago", "Monto Bs."]); // el metodo de pago sigue
  assert.deepEqual(modelo.autorizacion, []);
  assert.equal((await generarFacturaPdfBuffer(factura)).subarray(0, 4).toString(), "%PDF");
});

test("el servidor pone el precio: un total que no coincide con los productos se rechaza y no queda nada registrado", async () => {
  const antes = await repo.contarTransacciones();
  await assert.rejects(registrarPagoSimple({ metodo: "QR", monto: 100, items: ARROZ_Y_ACEITE }), { status: 400, message: /no coincide/ });
  await assert.rejects(registrarPagoSimple({ metodo: "QR", monto: 10, items: [{ sku: "NO-EXISTE", cantidad: 1 }] }), { status: 400, message: /catálogo/ });
  await assert.rejects(registrarPagoSimple({ metodo: "QR", monto: 10, items: [{ sku: "ARR-001", cantidad: 0 }] }), { status: 400 });
  await assert.rejects(registrarPagoSimple({ metodo: "QR", monto: 10, items: "x" }), { status: 400 });
  assert.equal(await repo.contarTransacciones(), antes);
});

test("una venta sin productos (solo monto) sigue igual: sin tabla de productos", async () => {
  const r = await registrarPagoSimple({ metodo: "Tarjeta", monto: 33 });
  ids.push(r.pago.id_transaccion);
  const factura = await construirFacturaDigital(r.pago.id_transaccion);
  assert.equal(factura.productos, null);
  assert.equal(construirModeloComprobante(factura).productos, null);
});

test("pago mixto con productos: se guardan y el total tiene que cuadrar", async () => {
  await assert.rejects(
    registrarPagoMixto({ cajaId: "CAJA-02", total: 100, metodos: [{ metodo: "Efectivo", monto: 50 }, { metodo: "QR", monto: 50 }], items: ARROZ_Y_ACEITE }),
    { status: 400, message: /no coincide/ }
  );
  const r = await registrarPagoMixto({ cajaId: "CAJA-02", total: 205, metodos: [{ metodo: "Efectivo", monto: 100 }, { metodo: "QR", monto: 105 }], items: ARROZ_Y_ACEITE, cajeroNombre: "Rosa Mamani" });
  ids.push(r.pago.id_transaccion);
  // Se comprueba lo guardado y no la factura: abrir la factura de un pago mixto necesita que la BD ya no tenga la restriccion UNIQUE de
  // token_verificacion (el script la quita; ver sql/script_pagos.sql) y eso es independiente de los productos.
  const guardados = await repo.listarItemsVenta(r.pago.id_transaccion);
  assert.equal(guardados.length, 2);
  assert.equal(r.transacciones.length, 2);
});

test("una venta anulada muestra el supervisor que autorizo la anulacion", async () => {
  const r = await registrarPagoSimple({ metodo: "Efectivo", monto: 15, caja_id: "CAJA-02", cajero_nombre: "Rosa Mamani", items: [{ sku: "ACE-002", cantidad: 1 }] });
  ids.push(r.pago.id_transaccion);
  await repo.anularTransaccion(r.pago.id_transaccion, { anulado_por: "sup-1", anulado_por_nombre: "Luis Angel Paredes Torrez", motivo: "Error de cobro" });

  const factura = await construirFacturaDigital(r.pago.id_transaccion);
  const modelo = construirModeloComprobante(factura);
  assert.equal(modelo.anulada, true);
  assert.deepEqual(modelo.autorizacion[0], ["Anulada con autorización de:", "Luis Angel Paredes Torrez"]);
  assert.ok(modelo.autorizacion.some(([k, v]) => k === "Motivo:" && v === "Error de cobro"));
  assert.equal((await generarFacturaPdfBuffer(factura)).subarray(0, 4).toString(), "%PDF");

  // las filas de productos se borran junto con la venta (limpieza)
  await repo.eliminarVentaRegistrada(r.pago.id_transaccion);
  assert.deepEqual(await repo.listarItemsVenta(r.pago.id_transaccion), []);
  ids.pop();
  const { rows } = await query(`SELECT 1 FROM pagos.transacciones WHERE id_transaccion = $1`, [r.pago.id_transaccion]);
  assert.equal(rows.length, 0);
});
