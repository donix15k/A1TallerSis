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
    // Uso interno (no se devuelve por la API): lo comprado de cada producto, para re-comprobar al guardar.
    comprados: [...productos.values()].map((p) => ({ descripcion: p.descripcion, precio_unitario: p.precio_unitario, comprada: p.comprada })),
  };
}

const CAJERO_MAX = 60; // largo de devoluciones.devoluciones.creado_por

// TDSI-23: una devolucion de mas de 500 Bs queda marcada como "Requiere autorizacion del supervisor".
const limiteAutorizacionBs = () => Number(process.env.LIMITE_AUTORIZACION_BS) || 500;
const requiereAutorizacion = (monto) => monto > limiteAutorizacionBs();

function validarCajero(valor) {
  const cajero = typeof valor === "string" ? valor.trim() : "";
  if (!cajero) throw new AppError("Falta el cajero que registra la devolución.", 400);
  if (cajero.length > CAJERO_MAX) throw new AppError(`El cajero no puede tener más de ${CAJERO_MAX} caracteres.`, 400);
  return cajero;
}

/**
 * TDSI-22: registra la solicitud de devolucion (estado PENDIENTE) con su codigo correlativo DEV-0001...
 *   cuerpo: lo de prepararDevolucion + { cajero } (quien la registra; en el Front es el correo de la sesion).
 * Devuelve el codigo que se le entrega al cliente para consultar el avance.
 */
async function registrarDevolucion(cuerpo = {}, opciones = {}) {
  const cajero = validarCajero(cuerpo.cajero);
  const { comprados, ...preparada } = await prepararDevolucion(cuerpo, opciones);

  const guardada = await devolucionesRepo.crearDevolucion({
    factura: preparada.factura,
    comprados,
    tipo: preparada.tipo,
    monto_total: preparada.monto_total,
    motivo_id: preparada.motivo.id,
    observaciones: preparada.observaciones,
    items: preparada.items,
    cajero,
    requiere_autorizacion: requiereAutorizacion(preparada.monto_total),
  });

  return {
    codigo: guardada.codigo,
    estado: guardada.estado,
    tipo: preparada.tipo,
    monto_total: preparada.monto_total,
    requiere_autorizacion: guardada.requiere_autorizacion,
    factura_numero: preparada.factura.numero,
    motivo: preparada.motivo,
    observaciones: preparada.observaciones,
    cajero,
    items: preparada.items,
    fecha_solicitud: guardada.fecha_solicitud,
  };
}

/**
 * TDSI-24: estado, items, motivo y monto de una devolucion, a partir del codigo que recibio el cliente
 * (acepta minusculas y espacios: " dev-0001 " -> DEV-0001). 400 si el codigo no tiene forma de codigo, 404 si no existe.
 */
async function obtenerDevolucion(codigo) {
  const normalizado = String(codigo ?? "").trim().toUpperCase();
  if (!/^DEV-\d{1,10}$/.test(normalizado)) {
    throw new AppError("El código de la devolución no es válido. Ejemplo: DEV-0001.", 400, { codigo });
  }
  const devolucion = await devolucionesRepo.obtenerPorCodigo(normalizado);
  if (!devolucion) throw new AppError(`No se encontró la devolución ${normalizado}.`, 404, { codigo: normalizado });
  return devolucion;
}

const ESTADOS = ["PENDIENTE", "APROBADA", "RECHAZADA", "PROCESADA"];
const LIMITE_LISTA_MAX = 1000;

/**
 * TDSI-33: devoluciones para la bandeja del supervisor. ?estado=PENDIENTE (no distingue mayusculas) filtra por
 * estado; sin estado trae todas. ?limite=N acota cuantas filas vienen (por defecto 200, maximo 1000);
 * "total" siempre es el conteo completo (el contador de la bandeja).
 */
async function listarDevoluciones({ estado, limite } = {}) {
  let estadoNormalizado = null;
  if (estado !== undefined && estado !== null && String(estado).trim() !== "") {
    estadoNormalizado = String(estado).trim().toUpperCase();
    if (!ESTADOS.includes(estadoNormalizado)) {
      throw new AppError(`El estado debe ser uno de: ${ESTADOS.join(", ")}.`, 400, { estado });
    }
  }
  let limiteNormalizado = 200;
  if (limite !== undefined && limite !== null && String(limite).trim() !== "") {
    limiteNormalizado = Number(limite);
    if (!Number.isInteger(limiteNormalizado) || limiteNormalizado < 1 || limiteNormalizado > LIMITE_LISTA_MAX) {
      throw new AppError(`El límite debe ser un número entero entre 1 y ${LIMITE_LISTA_MAX}.`, 400, { limite });
    }
  }
  return devolucionesRepo.listarDevoluciones({ estado: estadoNormalizado, limite: limiteNormalizado });
}

/**
 * Datos del supervisor que vienen en el cuerpo: { supervisor_id, pin } (tambien se acepta "usuario" como
 * otro nombre de supervisor_id). El PIN nunca se registra ni se devuelve.
 */
function credencialesDelCuerpo(cuerpo = {}) {
  return { usuario: cuerpo.supervisor_id ?? cuerpo.usuario, pin: cuerpo.pin };
}

/** Solo se resuelven (aprueban o rechazan) devoluciones PENDIENTES: cualquier otro estado es un conflicto (409). */
function exigirPendiente(devolucion, accion) {
  if (devolucion.estado !== "PENDIENTE") {
    throw new AppError(
      `La devolución ${devolucion.codigo} ya está ${devolucion.estado} y no se puede ${accion}: solo se resuelven las PENDIENTES.`,
      409,
      { codigo: devolucion.codigo, estado: devolucion.estado }
    );
  }
}

/**
 * TDSI-35: el supervisor aprueba una devolucion PENDIENTE con su usuario y PIN (validados por Facturacion).
 * La devolucion pasa a APROBADA y queda guardado quien la autorizo (autorizado_por) y a que hora (autorizado_en).
 * Orden de las comprobaciones: 1) el codigo existe, 2) sigue PENDIENTE (409 si no; asi un PIN no se gasta
 * en algo que ya no se puede aprobar), 3) usuario y PIN, 4) el cambio de estado (que solo toca filas todavia
 * PENDIENTES: si otro supervisor la resolvio justo antes, tambien 409).
 */
async function aprobarDevolucion(codigo, cuerpo = {}) {
  const actual = await obtenerDevolucion(codigo);
  exigirPendiente(actual, "aprobar");

  const { usuario, pin } = credencialesDelCuerpo(cuerpo);
  const supervisor = await facturacionProxy.validarSupervisor(usuario, pin);

  const aprobada = await devolucionesRepo.aprobarPendiente(actual.codigo, supervisor.supervisor_id);
  if (!aprobada) {
    const ahora = await devolucionesRepo.obtenerPorCodigo(actual.codigo);
    exigirPendiente(ahora, "aprobar");
  }
  return obtenerDevolucion(actual.codigo);
}

const MOTIVO_RECHAZO_MIN = 10;
const MOTIVO_RECHAZO_MAX = 300; // largo de devoluciones.devoluciones.motivo_rechazo

/** El motivo del rechazo: texto de al menos 10 caracteres (sin contar espacios de los extremos) y a lo sumo 300. */
function validarMotivoRechazo(valor) {
  const motivo = typeof valor === "string" ? valor.trim() : "";
  if (motivo.length < MOTIVO_RECHAZO_MIN) {
    throw new AppError(`El motivo del rechazo debe tener al menos ${MOTIVO_RECHAZO_MIN} caracteres.`, 400, { minimo: MOTIVO_RECHAZO_MIN });
  }
  if (motivo.length > MOTIVO_RECHAZO_MAX) {
    throw new AppError(`El motivo del rechazo puede tener como máximo ${MOTIVO_RECHAZO_MAX} caracteres.`, 400, { maximo: MOTIVO_RECHAZO_MAX });
  }
  return motivo;
}

/**
 * TDSI-36: el supervisor rechaza una devolucion PENDIENTE: escribe el motivo del rechazo (minimo 10 caracteres)
 * y su usuario y PIN. La devolucion pasa a RECHAZADA y el motivo queda guardado. Comprobaciones en este orden
 * (para no gastar un intento de PIN en algo que ya falla): codigo existe -> sigue PENDIENTE (409) -> motivo
 * valido (400) -> usuario y PIN (401/423/400) -> cambio de estado (409 si otro la resolvio justo antes).
 *   cuerpo: { supervisor_id, pin, motivo_rechazo }  (tambien se acepta "motivo")
 */
async function rechazarDevolucion(codigo, cuerpo = {}) {
  const actual = await obtenerDevolucion(codigo);
  exigirPendiente(actual, "rechazar");
  const motivoRechazo = validarMotivoRechazo(cuerpo.motivo_rechazo ?? cuerpo.motivo);

  const { usuario, pin } = credencialesDelCuerpo(cuerpo);
  await facturacionProxy.validarSupervisor(usuario, pin);

  const rechazada = await devolucionesRepo.rechazarPendiente(actual.codigo, motivoRechazo);
  if (!rechazada) {
    const ahora = await devolucionesRepo.obtenerPorCodigo(actual.codigo);
    exigirPendiente(ahora, "rechazar");
  }
  return obtenerDevolucion(actual.codigo);
}

module.exports = {
  consultarFacturaParaDevolucion,
  repartirYaDevuelto,
  listarMotivos,
  calcularMonto,
  prepararDevolucion,
  registrarDevolucion,
  obtenerDevolucion,
  listarDevoluciones,
  aprobarDevolucion,
  rechazarDevolucion,
};
