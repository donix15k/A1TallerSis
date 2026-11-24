// Cada venta de caja emite su factura oficial F-NNNNNN en Facturacion (como el Marketplace). Aqui el emisor es FALSO: nunca se crea una factura real
// ni se publica a Contabilidad. BD real para las ventas; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { registrarPagoSimple } = require("../services/pagoSimpleService");
const { registrarPagoMixto } = require("../services/pagoMixtoService");
const { usarEmisorDePrueba, NIT_SIN_DATOS, RAZON_SIN_DATOS } = require("../services/facturaVentaCajaService");
const { construirFacturaDigital } = require("../services/facturaDigitalService");
const { construirModeloComprobante } = require("../services/comprobanteModelo");
const repo = require("../data/pagosRepo");
const { query } = require("../config/db");

const ids = [];
let llamadas = [];
let siguiente = 9000;
test.beforeEach(() => {
  llamadas = [];
  usarEmisorDePrueba(async (datos) => {
    llamadas.push(datos);
    return { numero: `F-${String(++siguiente).padStart(6, "0")}` };
  });
});
test.after(async () => {
  usarEmisorDePrueba(undefined);
  for (const id of ids) await repo.eliminarVentaRegistrada(id);
});

const numeroGuardado = async (id) => (await query(`SELECT DISTINCT numero_factura, factura_error FROM pagos.transacciones WHERE id_transaccion = $1`, [id])).rows;

test("una venta con productos emite su factura con esos productos y guarda el numero F-", async () => {
  const r = await registrarPagoSimple({ metodo: "Tarjeta", monto: 205, tipo_documento: "NIT", nit: "1023456789", razon_social: "Maria Quispe", items: [{ sku: "ARR-001", cantidad: 2 }, { sku: "ACE-002", cantidad: 1 }] });
  ids.push(r.pago.id_transaccion);

  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0].items, [
    { descripcion: "Arroz Grano de Oro 10 kg", cantidad: 2, precio_unitario: 95 },
    { descripcion: "Aceite Fino vegetal 900 ml", cantidad: 1, precio_unitario: 15 },
  ]);
  assert.deepEqual([llamadas[0].nit, llamadas[0].razon_social, llamadas[0].metodo_pago, llamadas[0].canal], ["1023456789", "Maria Quispe", "Tarjeta", "Presencial"]);
  assert.equal(r.pago.numero_factura, "F-009001");
  assert.deepEqual(await numeroGuardado(r.pago.id_transaccion), [{ numero_factura: "F-009001", factura_error: null }]);

  // el comprobante dice a que factura oficial corresponde
  const modelo = construirModeloComprobante(await construirFacturaDigital(r.pago.id_transaccion));
  assert.ok(modelo.datos.some(([k, v]) => k === "Factura N°:" && v === "F-009001"));
});

test("una venta sin productos ni datos de cliente se factura como Consumidor final con una linea Venta", async () => {
  const r = await registrarPagoSimple({ metodo: "Efectivo", monto: 33 });
  ids.push(r.pago.id_transaccion);
  assert.deepEqual(llamadas[0].items, [{ descripcion: "Venta", cantidad: 1, precio_unitario: 33 }]);
  assert.deepEqual([llamadas[0].nit, llamadas[0].razon_social], [NIT_SIN_DATOS, RAZON_SIN_DATOS]);
});

test("un pago mixto emite la factura con los dos metodos de pago", async () => {
  const r = await registrarPagoMixto({ cajaId: "CAJA-02", total: 205, metodos: [{ metodo: "Efectivo", monto: 100 }, { metodo: "QR", monto: 105 }], items: [{ sku: "ARR-001", cantidad: 2 }, { sku: "ACE-002", cantidad: 1 }] });
  ids.push(r.pago.id_transaccion);
  assert.deepEqual(llamadas[0].metodos_pago, [{ metodo: "Efectivo", monto: 100 }, { metodo: "QR", monto: 105 }]);
  assert.equal(llamadas[0].metodo_pago, undefined);
  assert.equal(llamadas[0].items.length, 2);
  assert.equal(r.pago.numero_factura, "F-009003");
  assert.equal((await numeroGuardado(r.pago.id_transaccion)).length, 1); // las dos filas del mixto llevan el mismo numero
});

test("si Facturacion falla, la venta NO se pierde: queda registrada con el error", async () => {
  usarEmisorDePrueba(async () => { throw new Error("No se pudo contactar a facturacion para emitir la factura."); });
  const r = await registrarPagoSimple({ metodo: "QR", monto: 12 });
  ids.push(r.pago.id_transaccion);
  assert.equal(r.pago.numero_factura, null);
  assert.deepEqual(await numeroGuardado(r.pago.id_transaccion), [{ numero_factura: null, factura_error: "No se pudo contactar a facturacion para emitir la factura." }]);
});

test("sin emisor de prueba, las pruebas automaticas no emiten facturas reales", async () => {
  usarEmisorDePrueba(undefined);
  const r = await registrarPagoSimple({ metodo: "QR", monto: 11 });
  ids.push(r.pago.id_transaccion);
  assert.deepEqual(await numeroGuardado(r.pago.id_transaccion), [{ numero_factura: null, factura_error: null }]);
});
