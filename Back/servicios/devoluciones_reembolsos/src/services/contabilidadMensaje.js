// TDSI-91: el mensaje de la nota de credito en el formato que pide el Modulo de Contabilidad (Grupo D).
// Contabilidad lee solo el cuerpo y sistema_origen debe ser exactamente "FACTURACION" (igual que las facturas).

const num = (v) => Math.round(Number(v || 0) * 100) / 100;

// Fecha del documento en hora de Bolivia (YYYY-MM-DD): una nota de las 22:00 es de ese dia, no del siguiente.
const fechaBolivia = (v) => new Date(v).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });

const MOTIVO_MINIMO = 10; // Contabilidad rechaza motivos mas cortos (como en las anulaciones)
const MOTIVO_MAXIMO = 300;

/**
 * Motivo legible para Contabilidad: "Devolución DEV-0007: Producto defectuoso (observaciones)". Siempre tiene al menos
 * 10 caracteres (el nombre del motivo solo, como "Otro", no alcanzaria).
 */
function motivoDe(devolucion) {
  const base = `Devolución ${devolucion.codigo}: ${devolucion.motivo?.nombre || "sin motivo"}`;
  const obs = String(devolucion.observaciones || "").trim();
  return (obs ? `${base} (${obs})` : base).slice(0, MOTIVO_MAXIMO);
}

/**
 * Arma el mensaje NOTA_CREDITO:
 *   sistema_origen "FACTURACION", tipo_operacion "nota_credito", referencia_externa = numero de la nota (NC-000001; con
 *   otra referencia lo tomarian como duplicado de la venta), apuntando a la factura original, con el monto y el motivo.
 * Recibe lo ya leido: la nota (numero, monto, emitida_en), la devolucion (codigo, factura_numero, motivo, observaciones)
 * y la factura original (cliente_nit, cliente_nombre).
 */
function armarMensajeNotaCredito({ nota, devolucion, factura = {} }) {
  const fecha = fechaBolivia(nota.emitida_en);
  return {
    sistema_origen: "FACTURACION",
    referencia_externa: nota.numero,
    tipo_operacion: "nota_credito",
    fecha_documento: fecha,
    datos: {
      fecha_documento: fecha,
      id_documento_original: devolucion.factura_numero,
      tipo_documento_original: "venta",
      nit_cliente: factura.cliente_nit ?? null,
      nombre_cliente: factura.cliente_nombre || "Consumidor final",
      monto: num(nota.monto),
      motivo: motivoDe(devolucion),
    },
  };
}

/** Clave de idempotencia de una nota: nc-{numero}, con el numero sin el prefijo NC- (NC-000001 -> nc-000001). */
const claveIdempotencia = (numeroNota) => `nc-${String(numeroNota).replace(/^NC-/i, "")}`;

module.exports = { armarMensajeNotaCredito, motivoDe, fechaBolivia, claveIdempotencia, MOTIVO_MINIMO };
