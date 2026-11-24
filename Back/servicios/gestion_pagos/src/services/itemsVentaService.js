const { AppError } = require("../utils/AppError");
const { CATALOGO } = require("./simulacionService");
const repo = require("../data/pagosRepo");

const MAX_UNIDADES = 50;

/**
 * Productos de una venta de caja (la tiendita del cajero): llegan como [{ sku, cantidad }] y el SERVIDOR pone la descripcion y el precio
 * del catalogo (nunca se confia en un precio que mande el navegador). Devuelve null si la venta no trae productos (cobro solo por monto);
 * si trae, el total de los productos tiene que ser igual al monto cobrado.
 */
function resolverItemsVenta(items, total) {
  if (items === undefined || items === null) return null;
  if (!Array.isArray(items)) throw new AppError("Los productos de la venta deben ser una lista.", 400);
  if (items.length === 0) return null;

  const porSku = new Map();
  for (const it of items) {
    const sku = String(it?.sku ?? "").trim();
    const producto = CATALOGO.find((p) => p.sku === sku);
    if (!producto) throw new AppError(`El producto "${sku}" no existe en el catálogo.`, 400, { sku });
    const cantidad = Number(it.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1) throw new AppError(`La cantidad de ${producto.descripcion} debe ser un entero mayor a 0.`, 400, { sku });
    const acumulada = (porSku.get(sku)?.cantidad ?? 0) + cantidad;
    if (acumulada > MAX_UNIDADES) throw new AppError(`Máximo ${MAX_UNIDADES} unidades de ${producto.descripcion}.`, 400, { sku });
    porSku.set(sku, { producto, cantidad: acumulada });
  }

  const lineas = [...porSku.values()].map(({ producto, cantidad }) => ({
    sku: producto.sku,
    descripcion: producto.descripcion,
    cantidad,
    precio_unitario: producto.precio,
    subtotal: Math.round(cantidad * producto.precio * 100) / 100,
  }));
  const totalCentavos = lineas.reduce((a, l) => a + Math.round(l.subtotal * 100), 0);
  if (totalCentavos !== Math.round(Number(total) * 100)) {
    throw new AppError(`El total de los productos (Bs ${(totalCentavos / 100).toFixed(2)}) no coincide con el monto cobrado (Bs ${Number(total).toFixed(2)}).`, 400, { total_productos: totalCentavos / 100, monto: Number(total) });
  }
  return lineas;
}

/** Guarda los productos de la venta recien registrada; si no se pueden guardar, la venta se deshace (no queda cobrada sin su detalle). */
async function guardarItemsVenta(id_transaccion, lineas) {
  if (!lineas) return;
  try {
    await repo.insertarItemsVenta(id_transaccion, lineas);
  } catch (e) {
    await repo.eliminarVentaRegistrada(id_transaccion);
    throw e;
  }
}

module.exports = { resolverItemsVenta, guardarItemsVenta };
