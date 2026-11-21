// TDSI-126/129: los envios de Devoluciones a otros grupos (Contabilidad, Compras, Marketplace) en un formato comun, para el
// Monitor de integraciones del administrador (lo reune Gestion de Pagos), y su reenvio.
const { query } = require("../config/db");
const contabilidadRepo = require("../data/enviosContabilidadRepo");
const comprasRepo = require("../data/enviosComprasRepo");
const marketplaceRepo = require("../data/enviosMarketplaceRepo");
const contabilidad = require("./contabilidadService");
const compras = require("./comprasService");
const marketplace = require("./marketplaceService");
const { AppError } = require("../utils/AppError");

/** Estados comunes del monitor: Enviado, Respondido (la otra parte ya contesto), Pendiente (se reintenta) o Error. */
function estadoComun(estado, respondido) {
  if (respondido) return "Respondido";
  return ["Enviado", "Pendiente", "Error"].includes(estado) ? estado : estado === "Recibido" ? "Respondido" : estado;
}

const FUENTES = {
  contabilidad: {
    grupo: "D",
    tipo: "NOTA_CREDITO",
    sql: `SELECT e.id, n.numero AS referencia, d.codigo, e.estado, e.intentos, e.ultimo_error, e.pubsub_message_id,
                 COALESCE(e.enviado_en, e.creado_en) AS fecha, e.resultado, e.numero_asiento, e.resultado_motivo, e.payload
            FROM devoluciones.envios_contabilidad_nc e
            JOIN devoluciones.notas_credito n ON n.id = e.nota_credito_id
            JOIN devoluciones.devoluciones d ON d.id = n.devolucion_id`,
    respondido: (r) => Boolean(r.resultado),
    detalle: (r) => ({ resultado: r.resultado, numero_asiento: r.numero_asiento, motivo_rechazo: r.resultado_motivo }),
  },
  compras: {
    grupo: "C",
    tipo: "PRODUCTOS_DEVUELTOS",
    sql: `SELECT e.id, d.codigo AS referencia, d.codigo, e.estado, e.intentos, e.ultimo_error, e.pubsub_message_id,
                 COALESCE(e.enviado_en, e.creado_en) AS fecha, e.acuse, e.numero_reclamo, e.payload
            FROM devoluciones.envios_compras_dev e
            JOIN devoluciones.devoluciones d ON d.id = e.devolucion_id`,
    respondido: (r) => Boolean(r.acuse),
    detalle: (r) => ({ acuse: r.acuse, numero_reclamo: r.numero_reclamo }),
  },
  marketplace: {
    grupo: "E",
    tipo: "DEVOLUCION_RESUELTA",
    sql: `SELECT e.id, d.codigo AS referencia, d.codigo, e.estado, e.intentos, e.ultimo_error, e.pubsub_message_id,
                 COALESCE(e.enviado_en, e.creado_en) AS fecha, e.resultado, e.payload
            FROM devoluciones.envios_marketplace_dev e
            JOIN devoluciones.devoluciones d ON d.id = e.devolucion_id`,
    respondido: () => false, // el Marketplace no contesta este aviso
    detalle: (r) => ({ resultado: r.resultado }),
  },
};

/**
 * Todos los envios de Devoluciones, del mas reciente al mas viejo, en el formato comun:
 *   { origen: "devoluciones", id: "contabilidad-12", fuente, grupo (C, D, E), tipo, referencia, fecha, estado, message_id,
 *     intentos, error, puede_reenviar, detalle, datos (el mensaje enviado) }
 * El id lleva la fuente porque son tres tablas distintas; sirve tal cual para reenviarlo.
 */
async function listarMensajes({ limite = 500 } = {}) {
  const todos = [];
  for (const [fuente, f] of Object.entries(FUENTES)) {
    const { rows } = await query(`${f.sql} ORDER BY e.id DESC LIMIT $1`, [limite]);
    for (const r of rows) {
      const estado = estadoComun(r.estado, f.respondido(r));
      todos.push({
        origen: "devoluciones",
        id: `${fuente}-${Number(r.id)}`,
        fuente,
        grupo: f.grupo,
        tipo: f.tipo,
        referencia: r.referencia,
        devolucion: r.codigo,
        fecha: r.fecha,
        estado,
        message_id: r.pubsub_message_id || null,
        intentos: r.intentos,
        error: r.ultimo_error || null,
        puede_reenviar: r.estado === "Error" || (fuente === "contabilidad" && String(r.resultado ?? "").toLowerCase() === "rechazado"), // Error, o rechazado por Contabilidad
        detalle: f.detalle(r),
        datos: r.payload ?? null,
      });
    }
  }
  return todos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

/**
 * TDSI-129: reenvia un envio en Error (id "contabilidad-12", "compras-7" o "marketplace-3"): misma fila, nuevo ciclo de
 * intentos y un intento inmediato con la MISMA idempotency_key (el otro grupo no recibe duplicados). 404 si no existe,
 * 409 si no esta en Error. Devuelve el envio ya en el formato comun.
 */
async function reenviarMensaje(idComun) {
  const m = /^(contabilidad|compras|marketplace)-(\d{1,18})$/.exec(String(idComun || ""));
  if (!m) throw new AppError("El id del mensaje no es válido (ejemplo: contabilidad-12).", 400, { id: idComun });
  const [, fuente, id] = m;
  const repo = { contabilidad: contabilidadRepo, compras: comprasRepo, marketplace: marketplaceRepo }[fuente];
  const intentar = { contabilidad: contabilidad.intentarEnvio, compras: compras.intentarEnvio, marketplace: marketplace.intentarEnvio }[fuente];

  const actual = await repo.obtener(id);
  if (!actual) throw new AppError(`No existe el mensaje ${idComun}.`, 404, { id: idComun });
  const envio = await repo.prepararReenvio(id);
  if (!envio) throw new AppError(`Solo se pueden reenviar los envíos con estado Error o rechazados por Contabilidad (este está ${actual.estado}).`, 409, { id: idComun, estado: actual.estado });
  await intentar(envio);
  return (await listarMensajes()).find((x) => x.id === idComun);
}

module.exports = { listarMensajes, reenviarMensaje, estadoComun };
