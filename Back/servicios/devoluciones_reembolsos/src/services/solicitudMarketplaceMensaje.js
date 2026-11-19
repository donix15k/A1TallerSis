// TDSI-113: interpreta los mensajes SOLICITUD_DEVOLUCION que el Marketplace publica en nuestra suscripcion.
// El formato exacto lo define el Marketplace: se tolera que el tipo venga como tipo / tipo_mensaje / tipo_operacion y que
// los datos vengan dentro de "datos" o en la raiz.
const { AppError } = require("../utils/AppError");

const normalizar = (v) => String(v ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
const texto = (v) => (v === undefined || v === null ? "" : String(v).trim());

/**
 * Devuelve null si el mensaje NO es una solicitud de devolucion (otro tipo de mensaje de la suscripcion compartida: esos se
 * liberan para quien los lea). Si lo es, devuelve la solicitud normalizada:
 *   { id, orden_id, productos: [{ descripcion?, sku?, cantidad, estado_producto? }], motivo, observaciones }
 * y lanza AppError 400 si viene mal formada (esos se guardan con su error para revisarlos, TDSI-115).
 */
function interpretar(cuerpo) {
  let r;
  try {
    r = JSON.parse(cuerpo);
  } catch {
    return null; // ni siquiera es JSON: no se sabe de quien es; no es "nuestra"
  }
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const tipos = [r.tipo, r.tipo_mensaje, r.tipo_operacion].map(normalizar);
  if (!tipos.includes("SOLICITUD_DEVOLUCION")) return null;

  const d = r.datos && typeof r.datos === "object" ? r.datos : r;
  const orden_id = texto(d.orden_id ?? d.orden ?? d.id_orden ?? r.orden_id);
  if (!orden_id) throw new AppError("La solicitud no trae el número de orden (orden_id).", 400);
  if (orden_id.length > 60) throw new AppError("El número de orden es demasiado largo (máximo 60 caracteres).", 400, { orden_id });

  const lista = d.productos ?? d.items ?? r.productos;
  if (!Array.isArray(lista) || lista.length === 0) throw new AppError("La solicitud no trae productos a devolver.", 400, { orden_id });
  const productos = lista.map((p, i) => {
    const cantidad = Number(p?.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) throw new AppError(`El producto ${i + 1} de la solicitud no tiene una cantidad válida.`, 400, { orden_id, producto: p });
    const descripcion = texto(p?.descripcion ?? p?.nombre);
    const sku = texto(p?.sku);
    if (!descripcion && !sku) throw new AppError(`El producto ${i + 1} de la solicitud no tiene descripción ni SKU.`, 400, { orden_id, producto: p });
    return { descripcion: descripcion || null, sku: sku || null, cantidad, estado_producto: p?.estado_producto ?? null };
  });

  // Identificador de la solicitud: con el se evita registrarla dos veces si el mensaje llega repetido.
  const id = texto(r.referencia_externa ?? r.solicitud_id ?? r.id_solicitud ?? d.solicitud_id ?? d.id_solicitud) || `MKT-${orden_id}`;
  if (id.length > 100) throw new AppError("El identificador de la solicitud es demasiado largo (máximo 100 caracteres).", 400);

  return { id, orden_id, productos, motivo: texto(d.motivo ?? r.motivo) || null, observaciones: texto(d.observaciones ?? r.observaciones) || null };
}

module.exports = { interpretar };
