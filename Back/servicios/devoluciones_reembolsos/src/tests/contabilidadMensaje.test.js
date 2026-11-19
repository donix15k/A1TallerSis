// TDSI-91: formato del mensaje NOTA_CREDITO para Contabilidad (funcion pura, sin base ni red).
const test = require("node:test");
const assert = require("node:assert/strict");
const { armarMensajeNotaCredito, motivoDe, MOTIVO_MINIMO } = require("../services/contabilidadMensaje");

const nota = { numero: "NC-000007", monto: 41.5, emitida_en: "2026-03-10T14:30:00.000Z" };
const devolucion = { codigo: "DEV-0007", factura_numero: "F-000012", motivo: { id: 1, nombre: "Producto defectuoso" }, observaciones: null };
const factura = { numero: "F-000012", cliente_nit: "1234567", cliente_nombre: "Luis Paredes" };

test("formato de Contabilidad: sistema_origen FACTURACION, tipo_operacion nota_credito y referencia NC-XXXXXX", () => {
  const m = armarMensajeNotaCredito({ nota, devolucion, factura });
  assert.equal(m.sistema_origen, "FACTURACION");
  assert.equal(m.tipo_operacion, "nota_credito");
  assert.equal(m.referencia_externa, "NC-000007");
  assert.notEqual(m.referencia_externa, devolucion.factura_numero); // si fuera la de la venta, lo tomarian como duplicado
  assert.equal(m.fecha_documento, "2026-03-10");
});

test("los datos llevan la factura original, el monto, el motivo y el cliente", () => {
  const { datos } = armarMensajeNotaCredito({ nota, devolucion, factura });
  assert.deepEqual(datos, {
    fecha_documento: "2026-03-10",
    id_documento_original: "F-000012",
    tipo_documento_original: "venta",
    nit_cliente: "1234567",
    nombre_cliente: "Luis Paredes",
    monto: 41.5,
    motivo: "Devolución DEV-0007: Producto defectuoso",
  });
});

test("la fecha es la de Bolivia: una nota de las 22:00 del 10/03 (02:00Z del 11/03) es del 10/03", () => {
  const m = armarMensajeNotaCredito({ nota: { ...nota, emitida_en: "2026-03-11T02:00:00.000Z" }, devolucion, factura });
  assert.equal(m.fecha_documento, "2026-03-10");
  assert.equal(armarMensajeNotaCredito({ nota: { ...nota, emitida_en: "2026-03-10T04:00:00.000Z" }, devolucion, factura }).fecha_documento, "2026-03-10");
  assert.equal(armarMensajeNotaCredito({ nota: { ...nota, emitida_en: "2026-03-10T03:59:59.000Z" }, devolucion, factura }).fecha_documento, "2026-03-09");
});

test("el motivo siempre tiene al menos 10 caracteres (aunque el motivo sea 'Otro') y suma las observaciones", () => {
  const corto = motivoDe({ codigo: "DEV-1", motivo: { nombre: "Otro" } });
  assert.ok(corto.length >= MOTIVO_MINIMO);
  assert.equal(corto, "Devolución DEV-1: Otro");
  assert.equal(motivoDe({ ...devolucion, observaciones: "  caja rota  " }), "Devolución DEV-0007: Producto defectuoso (caja rota)");
  assert.equal(motivoDe({ codigo: "DEV-2", motivo: null }), "Devolución DEV-2: sin motivo");
  assert.ok(motivoDe({ ...devolucion, observaciones: "x".repeat(500) }).length <= 300);
});

test("sin datos del cliente: NIT null y 'Consumidor final'; el monto se redondea a 2 decimales", () => {
  const { datos } = armarMensajeNotaCredito({ nota: { ...nota, monto: "12.345" }, devolucion, factura: { cliente_nit: null, cliente_nombre: null } });
  assert.deepEqual([datos.nit_cliente, datos.nombre_cliente, datos.monto], [null, "Consumidor final", 12.35]);
  assert.equal(armarMensajeNotaCredito({ nota, devolucion }).datos.nombre_cliente, "Consumidor final"); // factura omitida
});

test("el mensaje es JSON puro (sin fechas ni undefined) y no lleva campos de mas en la raiz", () => {
  const m = armarMensajeNotaCredito({ nota, devolucion, factura });
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
  assert.deepEqual(Object.keys(m).sort(), ["datos", "fecha_documento", "referencia_externa", "sistema_origen", "tipo_operacion"]);
});
