const facturacionProxy = require("./facturacionProxy");
const devolucionesRepo = require("../data/devolucionesRepo");
const { estaDentroDePlazo } = require("../utils/plazo");
const { AppError } = require("../utils/AppError");

const OBSERVACIONES_MAX = 300;

// Redondeo a 2 decimales (mitad hacia arriba) sin los errores de la coma flotante: 4.995 -> 5.00.
const redondear = (n) => Math.round(Number((n * 100).toPrecision(12))) / 100;
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

/** TDSI-20: motivos activos para el desplegable de "Registrar devolucion". */
async function listarMotivos() {
  return devolucionesRepo.listarMotivosActivos();
}

// ---------------------------------------------------------------------------------------------
// TDSI-21: validar lo que el cliente devuelve y calcular el monto
// ---------------------------------------------------------------------------------------------

/**
 * Suma el subtotal (cantidad x precio, redondeado a 2 decimales) de cada producto devuelto. Se suman los
 * subtotales YA redondeados para que el monto siempre coincida con lo que se muestra linea por linea.
 */
function calcularMonto(items) {
  return redondear(items.reduce((acc, it) => acc + redondear(it.cantidad * it.precio_unitario), 0));
}

const tieneDosDecimalesComoMaximo = (n) => redondear(n) === n;

/**
 * Junta las lineas de la factura que son "el mismo producto" (misma descripcion y precio): el cajero ve
 * una sola fila por producto, asi que la cantidad que elige se compara contra el total de esas lineas.
 */
function productosDeLaFactura(itemsConDisponible) {
  const productos = new Map();
  for (const it of itemsConDisponible) {
    const k = claveItem(it.descripcion, it.precio_unitario);
    const p = productos.get(k) ?? { descripcion: it.descripcion, precio_unitario: it.precio_unitario, comprada: 0, disponible: 0 };
    p.comprada = redondear(p.comprada + it.cantidad_comprada);
    p.disponible = redondear(p.disponible + it.cantidad_disponible);
    productos.set(k, p);
  }
  return productos;
}

/** Que producto de la factura es el que pide el cajero (por descripcion y, si hace falta, por precio). */
function buscarProducto(productos, pedido) {
  const descripcion = String(pedido.descripcion ?? "").trim().toLowerCase();
  const coinciden = [...productos.values()].filter((p) => p.descripcion.trim().toLowerCase() === descripcion);
  if (coinciden.length === 0) {
    throw new AppError(`El producto "${pedido.descripcion}" no está en la factura.`, 422, { descripcion: pedido.descripcion });
  }
  if (pedido.precio_unitario === undefined || pedido.precio_unitario === null) {
    if (coinciden.length > 1) {
      throw new AppError(`"${pedido.descripcion}" está en la factura con distintos precios: indique el precio_unitario.`, 400);
    }
    return coinciden[0];
  }
  const elegido = coinciden.find((p) => redondear(p.precio_unitario) === redondear(Number(pedido.precio_unitario)));
  if (!elegido) {
    throw new AppError(`El producto "${pedido.descripcion}" no está en la factura con ese precio.`, 422, { descripcion: pedido.descripcion });
  }
  return elegido;
}

function validarObservaciones(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== "string") throw new AppError("Las observaciones deben ser texto.", 400);
  const texto = valor.trim();
  if (texto.length > OBSERVACIONES_MAX) {
    throw new AppError(`Las observaciones pueden tener como máximo ${OBSERVACIONES_MAX} caracteres.`, 400, { maximo: OBSERVACIONES_MAX });
  }
  return texto === "" ? null : texto;
}

async function validarMotivo(motivoId) {
  if (motivoId === undefined || motivoId === null || motivoId === "") {
    throw new AppError("Elija el motivo de la devolución.", 400);
  }
  const id = Number(motivoId);
  const motivo = Number.isInteger(id) && id > 0 ? await devolucionesRepo.obtenerMotivoActivo(id) : null;
  if (!motivo) throw new AppError("El motivo elegido no existe o no está activo.", 422, { motivo_id: motivoId });
  return motivo;
}

/**
 * TDSI-21: valida la solicitud contra la factura y calcula lo que se va a registrar. No guarda nada.
 *   cuerpo: { factura_numero, items: [{ descripcion, cantidad, precio_unitario? }], motivo_id, observaciones? }
 * Reglas: factura valida y dentro de plazo; al menos un producto; cada producto esta en la factura, sin
 * repetirse y con cantidad > 0 que NO supera la disponible; motivo activo; observaciones <= 300.
 * El monto se calcula con los precios de la FACTURA (no con lo que mande el cliente). El tipo es TOTAL si se
 * devuelve todo lo comprado de cada producto, y PARCIAL en cualquier otro caso.
 */
async function prepararDevolucion(cuerpo = {}, { ahora = new Date() } = {}) {
  const pedidos = cuerpo.items;
  if (!Array.isArray(pedidos) || pedidos.length === 0) {
    throw new AppError("Elija al menos un producto a devolver.", 400);
  }
  const observaciones = validarObservaciones(cuerpo.observaciones);

  const consulta = await consultarFacturaParaDevolucion(cuerpo.factura_numero, { ahora });
  if (!consulta.devolvible) {
    throw new AppError(consulta.bloqueo.mensaje, 422, { codigo: consulta.bloqueo.codigo, factura_numero: consulta.factura.numero });
  }

  const productos = productosDeLaFactura(consulta.items);
  const elegidos = new Map(); // clave -> { producto, cantidad }
  for (const pedido of pedidos) {
    const cantidad = Number(pedido?.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0 || !tieneDosDecimalesComoMaximo(cantidad)) {
      throw new AppError(`La cantidad de "${pedido?.descripcion}" debe ser un número mayor a 0 (máximo 2 decimales).`, 400);
    }
    const producto = buscarProducto(productos, pedido);
    const k = claveItem(producto.descripcion, producto.precio_unitario);
    if (elegidos.has(k)) throw new AppError(`El producto "${producto.descripcion}" está repetido en la solicitud.`, 400);
    if (cantidad > producto.disponible) {
      throw new AppError(
        `No puede devolver ${cantidad} de "${producto.descripcion}": solo quedan ${producto.disponible} disponibles.`,
        422,
        { descripcion: producto.descripcion, disponible: producto.disponible }
      );
    }
    elegidos.set(k, { producto, cantidad });
  }

  const motivo = await validarMotivo(cuerpo.motivo_id);

  const items = [...elegidos.values()].map(({ producto, cantidad }) => ({
    descripcion: producto.descripcion,
    cantidad,
    precio_unitario: producto.precio_unitario,
    subtotal: redondear(cantidad * producto.precio_unitario),
  }));
  const devuelveTodo = [...productos.entries()].every(([k, p]) => elegidos.get(k)?.cantidad === p.comprada);

  return {
    factura: consulta.factura,
    items,
    tipo: devuelveTodo ? "TOTAL" : "PARCIAL",
    monto_total: calcularMonto(items),
    motivo,
    observaciones,
  };
}

module.exports = {
  consultarFacturaParaDevolucion,
  repartirYaDevuelto,
  listarMotivos,
  calcularMonto,
  prepararDevolucion,
};
