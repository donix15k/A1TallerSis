// TDSI-103: formato del mensaje PRODUCTOS_DEVUELTOS para Compras (funcion pura, sin base ni red).
const test = require("node:test");
const assert = require("node:assert/strict");
const { armarMensajeProductosDevueltos, SISTEMA_ORIGEN } = require("../services/comprasMensaje");

const devolucion = {
  codigo: "DEV-0042",
  factura_numero: "F-000012",
  motivo: { id: 1, nombre: "Producto defectuoso" },
  observaciones: "  llego con la tapa rota ",
  items: [
    { descripcion: "Cuaderno", cantidad: 2, precio_unitario: 12.5, subtotal: 25, estado_producto: "BUEN_ESTADO" },
    { descripcion: "Lapicero", cantidad: 1.5, precio_unitario: 2, subtotal: 3, estado_producto: "DEFECTUOSO" },
  ],
};
const cuando = "2026-03-10T14:30:00.000Z";

test("sobre del grupo: sistema_origen A1, referencia = codigo de la devolucion y tipo_operacion productos_devueltos", () => {
  const m = armarMensajeProductosDevueltos({ devolucion, procesadaEn: cuando });
  assert.equal(m.sistema_origen, "GESTION_DE_PAGOS_Y_FACTURACION");
  assert.equal(m.sistema_origen, SISTEMA_ORIGEN);
  assert.equal(m.referencia_externa, "DEV-0042");
  assert.equal(m.tipo_operacion, "productos_devueltos");
  assert.equal(m.fecha_documento, "2026-03-10");
});

test("los datos llevan codigo, factura, motivo y los productos con su cantidad y estado", () => {
  const { datos } = armarMensajeProductosDevueltos({ devolucion, procesadaEn: cuando });
  assert.deepEqual(datos, {
    codigo_devolucion: "DEV-0042",
    factura_numero: "F-000012",
    motivo: "Producto defectuoso",
    observaciones: "llego con la tapa rota",
    productos: [
      { descripcion: "Cuaderno", cantidad: 2, estado_producto: "BUEN_ESTADO" },
      { descripcion: "Lapicero", cantidad: 1.5, estado_producto: "DEFECTUOSO" },
    ],
    hay_defectuosos: true,
    generado_en: "2026-03-10T14:30:00.000Z",
  });
});

test("hay_defectuosos es false si todo vuelve en buen estado; sin observaciones ni motivo van null", () => {
  const { datos } = armarMensajeProductosDevueltos({
    devolucion: { ...devolucion, motivo: null, observaciones: "", items: [devolucion.items[0]] },
    procesadaEn: cuando,
  });
  assert.deepEqual([datos.hay_defectuosos, datos.motivo, datos.observaciones], [false, null, null]);
});

test("la fecha del documento es la de Bolivia: 02:00Z del 11/03 es todavia el 10/03", () => {
  assert.equal(armarMensajeProductosDevueltos({ devolucion, procesadaEn: "2026-03-11T02:00:00.000Z" }).fecha_documento, "2026-03-10");
  assert.equal(armarMensajeProductosDevueltos({ devolucion, procesadaEn: "2026-03-11T04:00:00.000Z" }).fecha_documento, "2026-03-11");
});

test("es JSON puro, sin precios (a Compras no le sirven) y cada producto trae solo descripcion, cantidad y estado", () => {
  const m = armarMensajeProductosDevueltos({ devolucion, procesadaEn: cuando });
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
  for (const p of m.datos.productos) assert.deepEqual(Object.keys(p).sort(), ["cantidad", "descripcion", "estado_producto"]);
  assert.deepEqual(Object.keys(m).sort(), ["datos", "fecha_documento", "referencia_externa", "sistema_origen", "tipo_operacion"]);
});
