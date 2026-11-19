// TDSI-103: el aviso de productos devueltos para Compras (Grupo C), en el mismo sobre que ya usan los demas mensajes del
// grupo (sistema_origen / referencia_externa / tipo_operacion / fecha_documento / datos).

// Somos el grupo A1: "Gestión de Pagos y Facturación" (mismo valor que slugificarOrigen en Gestión de Pagos).
const SISTEMA_ORIGEN = "GESTION_DE_PAGOS_Y_FACTURACION";

const num = (v) => Math.round(Number(v || 0) * 100) / 100;

// Fecha del documento en hora de Bolivia (YYYY-MM-DD): una devolucion de las 22:00 es de ese dia, no del siguiente.
const fechaBolivia = (v) => new Date(v).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });

/**
 * Arma el mensaje PRODUCTOS_DEVUELTOS de una devolucion PROCESADA:
 *   referencia_externa = codigo de la devolucion (DEV-0001; tambien es la idempotency_key: Compras lo toma una sola vez),
 *   tipo_operacion "productos_devueltos" y en datos: la factura, el motivo y cada producto con su cantidad y estado
 *   (BUEN_ESTADO vuelve al inventario; DEFECTUOSO -> Compras reclama al proveedor).
 * Recibe lo ya leido: la devolucion (codigo, factura_numero, motivo, observaciones, items con estado_producto) y la fecha
 * en que se proceso (por defecto, ahora).
 */
function armarMensajeProductosDevueltos({ devolucion, procesadaEn = new Date() }) {
  const productos = devolucion.items.map((i) => ({
    descripcion: i.descripcion,
    cantidad: num(i.cantidad),
    estado_producto: i.estado_producto,
  }));
  return {
    sistema_origen: SISTEMA_ORIGEN,
    referencia_externa: devolucion.codigo,
    tipo_operacion: "productos_devueltos",
    fecha_documento: fechaBolivia(procesadaEn),
    datos: {
      codigo_devolucion: devolucion.codigo,
      factura_numero: devolucion.factura_numero,
      motivo: devolucion.motivo?.nombre || null,
      observaciones: String(devolucion.observaciones || "").trim() || null,
      productos,
      hay_defectuosos: productos.some((p) => p.estado_producto === "DEFECTUOSO"),
      generado_en: new Date(procesadaEn).toISOString(),
    },
  };
}

module.exports = { armarMensajeProductosDevueltos, SISTEMA_ORIGEN };
