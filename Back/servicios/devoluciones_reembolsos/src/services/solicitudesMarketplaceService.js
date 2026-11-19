// TDSI-114: convierte una solicitud de devolucion del Marketplace en una devolucion PENDIENTE (origen MARKETPLACE), con las
// mismas reglas que una de la tienda (plazo, cantidades disponibles, motivo), mas las propias de un pedido online.
const devolucionService = require("./devolucionService");
const devolucionesRepo = require("../data/devolucionesRepo");
const { obtenerOrden } = require("./ventasOnlineProxy");
const { interpretar } = require("./solicitudMarketplaceMensaje");
const { AppError } = require("../utils/AppError");
const { query } = require("../config/db");

const SOLICITANTE = "MARKETPLACE"; // "cajero" de estas devoluciones (creado_por)

async function existentePorSolicitud(id) {
  const { rows } = await query(`SELECT codigo FROM devoluciones.devoluciones WHERE solicitud_externa = $1`, [id]);
  return rows[0]?.codigo || null;
}

/** El motivo del Marketplace se busca entre los motivos activos por nombre (sin distinguir mayusculas); si no coincide, "Otro". */
async function motivoDe(nombre) {
  const motivos = await devolucionesRepo.listarMotivosActivos();
  const buscado = String(nombre || "").trim().toLowerCase();
  const exacto = buscado && motivos.find((m) => m.nombre.toLowerCase() === buscado);
  if (exacto) return exacto;
  const otro = motivos.find((m) => m.nombre.toLowerCase() === "otro");
  if (!otro) throw new AppError("No hay un motivo \"Otro\" activo para registrar la solicitud.", 500);
  return otro;
}

/** Los productos de la solicitud pueden venir por SKU: se completa la descripcion con la de la orden. */
function productosConDescripcion(productos, orden) {
  return productos.map((p) => {
    if (p.descripcion) return p;
    const item = orden.items.find((i) => i.sku === p.sku);
    if (!item?.descripcion) throw new AppError(`La orden ${orden.orden_id} no tiene un producto con SKU ${p.sku}.`, 422, { orden_id: orden.orden_id, sku: p.sku });
    return { ...p, descripcion: item.descripcion };
  });
}

/**
 * Registra la solicitud (ya interpretada). Devuelve { duplicada, codigo }:
 *   - la misma solicitud (mismo identificador) no se registra dos veces: devuelve la devolucion que ya existe;
 *   - la orden debe existir en las ventas online, no estar anulada y tener su factura emitida (si no, 422);
 *   - luego aplica las reglas normales de una devolucion sobre esa factura (plazo, cantidades, productos de la factura).
 */
async function registrarSolicitud(solicitud) {
  const previa = await existentePorSolicitud(solicitud.id);
  if (previa) return { duplicada: true, codigo: previa };

  const orden = await obtenerOrden(solicitud.orden_id); // 404 si no existe; 503 si Gestion de Pagos no responde
  if (orden.estado === "Anulado") throw new AppError(`La orden ${orden.orden_id} está anulada: no se puede devolver.`, 422, { orden_id: orden.orden_id });
  if (!orden.factura_emitida) throw new AppError(`La orden ${orden.orden_id} todavía no tiene factura emitida.`, 422, { orden_id: orden.orden_id });

  const motivo = await motivoDe(solicitud.motivo);
  const items = productosConDescripcion(solicitud.productos, orden).map((p) => ({
    descripcion: p.descripcion,
    cantidad: p.cantidad,
    estado_producto: p.estado_producto || "BUEN_ESTADO",
  }));

  try {
    const d = await devolucionService.registrarDevolucion(
      { factura_numero: orden.numero_factura, items, motivo_id: motivo.id, observaciones: solicitud.observaciones, cajero: SOLICITANTE },
      {},
      { origen: "MARKETPLACE", orden_id: orden.orden_id, solicitud_externa: solicitud.id }
    );
    return { duplicada: false, codigo: d.codigo };
  } catch (e) {
    // dos mensajes iguales a la vez: el segundo choca con el indice unico de la solicitud y se toma como duplicado
    if (e.code === "23505" && /uq_devoluciones_solicitud_externa/.test(e.constraint || e.message || "")) {
      const codigo = await existentePorSolicitud(solicitud.id);
      if (codigo) return { duplicada: true, codigo };
    }
    throw e;
  }
}

/**
 * Procesa un mensaje de la suscripcion. propio = false si no es una solicitud de devolucion (se libera para otros).
 * Si lo es: { propio: true, solicitud, resultado } con la devolucion creada o ya existente; si es invalida lanza el error
 * (el job lo guarda en la tabla de revision y confirma el mensaje).
 */
async function procesarMensaje({ texto }) {
  const solicitud = interpretar(texto); // null si no es solicitud; AppError 400 si viene mal
  if (!solicitud) return { propio: false };
  const resultado = await registrarSolicitud(solicitud);
  return { propio: true, solicitud, resultado };
}

module.exports = { procesarMensaje, registrarSolicitud, SOLICITANTE };
