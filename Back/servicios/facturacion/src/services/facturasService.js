const facturasRepo = require("../data/facturasRepo");
const clientesService = require("./clientesService");

function err(mensaje, status = 400, detalle = null) {
  const e = new Error(mensaje);
  e.status = status;
  e.detalle = detalle;
  return e;
}

function validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw err("La factura debe tener al menos un item.");
  }
  for (const item of items) {
    if (
      !item.descripcion ||
      typeof item.cantidad !== "number" || item.cantidad <= 0 ||
      typeof item.precio_unitario !== "number" || item.precio_unitario < 0
    ) {
      throw err("Cada item debe tener descripcion, cantidad > 0 y precio_unitario >= 0.");
    }
  }
}

// Metodos de pago que acepta el sistema (los mismos del CHECK de facturacion.factura_metodos_pago).
const METODOS_PAGO = ["Efectivo", "Tarjeta", "QR", "Vale"]; // TDSI-70: "Vale" = vale de compra de una devolucion

const redondear = (n) => Math.round(Number((n * 100).toPrecision(12))) / 100;

/** "efectivo" / " QR " / "Qr" -> el nombre oficial ("Efectivo", "QR"); cualquier otro valor es un error 400. */
function normalizarMetodoPago(valor) {
  const buscado = String(valor ?? "").trim().toLowerCase();
  const metodo = METODOS_PAGO.find((m) => m.toLowerCase() === buscado);
  if (!metodo) {
    throw err(`El metodo de pago debe ser uno de: ${METODOS_PAGO.join(", ")}.`, 400, { metodo: valor ?? null });
  }
  return metodo;
}

/**
 * Metodo(s) de pago con que se pago la factura (obligatorio: Efectivo, Tarjeta o QR).
 *   - metodo_pago: "QR"                                   -> un solo metodo por el total de la factura
 *   - metodos_pago: [{ metodo: "Efectivo", monto: 20 },   -> pago mixto: cada metodo con su monto, y los montos
 *                    { metodo: "QR", monto: 28 }]            tienen que sumar exactamente el total
 */
function armarMetodosPago({ metodo_pago, metodos_pago }, total) {
  if (Array.isArray(metodos_pago) && metodos_pago.length > 0) {
    const metodos = metodos_pago.map((m) => ({ metodo: normalizarMetodoPago(m?.metodo), monto: redondear(Number(m?.monto)) }));
    if (metodos.some((m) => !Number.isFinite(m.monto) || m.monto <= 0)) {
      throw err("Cada metodo de pago debe tener un monto mayor a 0.");
    }
    const repetidos = metodos.map((m) => m.metodo).filter((m, i, todos) => todos.indexOf(m) !== i);
    if (repetidos.length > 0) throw err(`El metodo de pago ${repetidos[0]} esta repetido: sume sus montos en una sola linea.`);
    const suma = redondear(metodos.reduce((acc, m) => acc + m.monto, 0));
    if (suma !== total) {
      throw err(`Los montos por metodo de pago (Bs ${suma.toFixed(2)}) deben sumar el total de la factura (Bs ${total.toFixed(2)}).`, 400, { suma, total });
    }
    return metodos;
  }
  if (metodo_pago === undefined || metodo_pago === null || String(metodo_pago).trim() === "") {
    throw err(`Indique el metodo de pago de la factura (${METODOS_PAGO.join(", ")}).`);
  }
  return [{ metodo: normalizarMetodoPago(metodo_pago), monto: total }];
}

// Canal por donde se vendio: en mostrador ("Presencial", el valor por defecto) o por el Marketplace ("Online").
// Devoluciones lo usa: lo vendido por el Marketplace nunca se reembolsa con efectivo de caja.
const CANALES = ["Presencial", "Online"];

function normalizarCanal(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === "") return "Presencial";
  const canal = CANALES.find((c) => c.toLowerCase() === String(valor).trim().toLowerCase());
  if (!canal) throw err(`El canal debe ser uno de: ${CANALES.join(", ")}.`, 400, { canal: valor });
  return canal;
}

/** TDSI-89/279/280/281/282: ingresa el NIT y Razon Social del cliente al emitir la factura */
async function crearFactura({ nit, razon_social, items, metodo_pago, metodos_pago, canal } = {}) {
  validarItems(items);
  const canalNormalizado = normalizarCanal(canal);

  const itemsConSubtotal = items.map((i) => ({ ...i, subtotal: i.cantidad * i.precio_unitario }));
  const subtotal = itemsConSubtotal.reduce((acc, i) => acc + i.subtotal, 0);

  // Se valida el metodo de pago ANTES de guardar al cliente: una factura rechazada no debe dejar nada guardado.
  const metodosPago = armarMetodosPago({ metodo_pago, metodos_pago }, redondear(subtotal));

  // TDSI-280/282: guardarCliente valida el formato del NIT antes de guardar la factura
  const cliente = await clientesService.guardarCliente({ nit, razon_social });

  const factura = await facturasRepo.crearFactura({
    cliente_nit: cliente.nit,
    cliente_nombre: cliente.razon_social,
    canal: canalNormalizado,
    items: itemsConSubtotal,
    metodosPago,
    subtotal,
    descuento: 0,
    impuesto: 0,
    total: subtotal,
  });

  return { ...factura, metodosPago };
}

module.exports = { crearFactura, METODOS_PAGO };
