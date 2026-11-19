const facturacionProxy = require("./facturacionProxy");
const devolucionesRepo = require("../data/devolucionesRepo");
const { estaDentroDePlazo } = require("../utils/plazo");

const redondear = (n) => Math.round(n * 100) / 100;
const claveItem = (descripcion, precio) => `${String(descripcion).trim().toLowerCase()}|${redondear(precio).toFixed(2)}`;

/**
 * Cuanto de cada linea de la factura ya se devolvio. Si la misma descripcion y precio aparecen en
 * varias lineas, lo ya devuelto se reparte en orden (la primera linea se "llena" antes que la siguiente),
 * para no descontarlo dos veces.
 */
function repartirYaDevuelto(items, yaDevueltas) {
  const pendiente = new Map();
  for (const d of yaDevueltas) {
    const k = claveItem(d.descripcion, d.precio_unitario);
    pendiente.set(k, (pendiente.get(k) || 0) + d.cantidad);
  }
  return items.map((it) => {
    const k = claveItem(it.descripcion, it.precio_unitario);
    const restante = pendiente.get(k) || 0;
    const devuelta = Math.min(it.cantidad, restante);
    pendiente.set(k, redondear(restante - devuelta));
    return {
      descripcion: it.descripcion,
      precio_unitario: it.precio_unitario,
      subtotal: it.subtotal,
      cantidad_comprada: it.cantidad,
      cantidad_devuelta: redondear(devuelta),
      cantidad_disponible: redondear(it.cantidad - devuelta),
    };
  });
}

/** Por que una factura no se puede devolver (null si se puede). Solo se devuelven facturas validas, no anuladas. */
function bloqueoDe(factura, plazo) {
  if (factura.estado !== "Emitida") {
    const estado = factura.estado === "Anulada" ? "anulada" : "en proceso de anulación";
    return { codigo: "FACTURA_NO_VALIDA", mensaje: `Solo se pueden devolver facturas válidas: esta factura está ${estado}.` };
  }
  if (!plazo.dentro_de_plazo) {
    return { codigo: "FUERA_DE_PLAZO", mensaje: "Fuera de plazo" };
  }
  return null;
}

/**
 * TDSI-12: arma lo que necesita la pantalla "Devoluciones" al buscar una factura por su numero:
 * datos de la factura, si esta dentro del plazo de 7 dias y, por cada producto, cuanto se compro, cuanto
 * ya se devolvio y cuanto todavia se puede devolver.
 * Si la factura no existe lanza 404 ("No se encontró la factura"); si Facturacion no responde, 503.
 */
async function consultarFacturaParaDevolucion(numero, { ahora = new Date() } = {}) {
  const factura = await facturacionProxy.obtenerFactura(numero);
  const yaDevueltas = await devolucionesRepo.cantidadesYaDevueltas(factura.numero);

  const plazo = estaDentroDePlazo(factura.fecha, ahora);
  const bloqueo = bloqueoDe(factura, plazo);

  return {
    factura: {
      numero: factura.numero,
      fecha: factura.fecha,
      cliente_nit: factura.cliente_nit,
      cliente_nombre: factura.cliente_nombre,
      metodo_pago: factura.metodo_pago,
      metodos_pago: factura.metodos_pago,
      total: factura.total,
      estado: factura.estado,
    },
    plazo: { ...plazo, mensaje: plazo.dentro_de_plazo ? null : "Fuera de plazo" },
    devolvible: bloqueo === null,
    bloqueo,
    items: repartirYaDevuelto(factura.items, yaDevueltas),
  };
}

module.exports = { consultarFacturaParaDevolucion, repartirYaDevuelto };
