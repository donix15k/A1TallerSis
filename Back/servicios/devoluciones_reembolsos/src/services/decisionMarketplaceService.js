// Aviso al Marketplace (Grupo E) de lo que decidio el SUPERVISOR sobre una devolucion de productos que ese Marketplace vendio: se publica en su
// topico (ucb-sis323-sub-e) en el mismo sobre que usan los demas mensajes del grupo (sistema_origen / referencia_externa / tipo_operacion /
// fecha_documento / datos), en el momento en que el supervisor APRUEBA o RECHAZA (no al reembolsar). Es un envio NUEVO e independiente: no usa ni
// cambia el aviso DEVOLUCION_RESUELTA (marketplaceService.js). Cada decision se avisa una sola vez; queda en el registro de Pub/Sub.
const { query } = require("../config/db");
const { registrarEnvio } = require("../utils/pubsubLog");
const { publicar } = require("../clients/pubsubPublisher");
const { resolverNombres } = require("../utils/nombresPersonas");
const { SISTEMA_ORIGEN } = require("./comprasMensaje");
const contabilidad = require("../config/contabilidad");
const devolucionService = require("./devolucionService");
const facturacionProxy = require("./facturacionProxy");

const VARIABLE = "MARKETPLACE_DECISION_PUBSUB_TOPIC";
const num = (v) => Math.round(Number(v || 0) * 100) / 100;
const fechaBolivia = (v) => new Date(v).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });
const horaBolivia = (v) => new Date(v).toLocaleTimeString("es-BO", { timeZone: "America/La_Paz", hour: "2-digit", minute: "2-digit", hour12: false });

// Solo para pruebas: fija el topico (las pruebas automaticas NO leen el del .env, para no publicar nada real).
let topicoPrueba;
function usarTopicoDePrueba(t) {
  topicoPrueba = t;
}
function topico() {
  if (topicoPrueba !== undefined) return topicoPrueba;
  if (process.env.NODE_TEST_CONTEXT) return null;
  return String(process.env[VARIABLE] || "").trim() || null;
}

/** El mensaje de la decision (la orden, los productos, el supervisor y el cajero con usuario y nombre, el motivo y la fecha y hora). */
function armarMensajeDecision({ devolucion, decision, ordenId, supervisor, cajero, decididaEn }) {
  const aprobada = decision === "APROBADA";
  const productos = devolucion.items.map((i) => ({ descripcion: i.descripcion, cantidad: num(i.cantidad), estado_producto: i.estado_producto, subtotal: num(i.subtotal) }));
  return {
    sistema_origen: SISTEMA_ORIGEN,
    referencia_externa: devolucion.codigo,
    tipo_operacion: "decision_devolucion",
    fecha_documento: fechaBolivia(decididaEn),
    datos: {
      orden_id: ordenId,
      codigo_devolucion: devolucion.codigo,
      factura_numero: devolucion.factura_numero,
      origen: devolucion.origen, // TIENDA (la pidio el cliente en caja) o MARKETPLACE (la solicito el Marketplace)
      resultado: aprobada ? "aprobada" : "rechazada",
      productos,
      monto_total: num(devolucion.monto_total),
      motivo_devolucion: devolucion.motivo?.nombre || null,
      // lo que escribio el supervisor al rechazar; al aprobar, las observaciones con que se registro la devolucion
      motivo_decision: aprobada ? String(devolucion.observaciones || "").trim() || devolucion.motivo?.nombre || null : devolucion.motivo_rechazo || null,
      supervisor: { usuario: supervisor.usuario, nombre: supervisor.nombre },
      cajero: { usuario: cajero.usuario, nombre: cajero.nombre },
      decidida_en: new Date(decididaEn).toISOString(),
      fecha: fechaBolivia(decididaEn),
      hora: horaBolivia(decididaEn),
    },
  };
}

/** La orden online a la que pertenece la factura (null si no es de un pedido del Marketplace). */
async function ordenDeLaFactura(numeroFactura) {
  try {
    const { rows } = await query(`SELECT orden_id FROM pagos.ventas_online WHERE numero_factura = $1 LIMIT 1`, [numeroFactura]);
    return rows[0]?.orden_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Avisa la decision (APROBADA / RECHAZADA) de una devolucion que el supervisor acaba de resolver. Solo aplica si los productos son del Marketplace: la
 * devolucion es de origen MARKETPLACE o su factura es de un pedido online. Devuelve { publicado, ... }; nunca lanza.
 */
async function avisarDecision(codigo) {
  const t = topico();
  if (!t) return { publicado: false, motivo: `${VARIABLE} no esta configurado` };

  const devolucion = await devolucionService.obtenerDevolucion(codigo);
  const decision = devolucion.estado === "RECHAZADA" ? "RECHAZADA" : ["APROBADA", "PROCESADA"].includes(devolucion.estado) ? "APROBADA" : null;
  if (!decision) return { publicado: false, motivo: `La devolución está ${devolucion.estado}: aun no se decidio.` };

  let ordenId = devolucion.orden_id || null;
  if (devolucion.origen !== "MARKETPLACE") {
    let factura = null;
    try {
      factura = await facturacionProxy.obtenerFactura(devolucion.factura_numero);
    } catch {
      return { publicado: false, motivo: "No se pudo comprobar de donde es la factura." };
    }
    if (factura?.canal !== "Online") return { publicado: false, motivo: "Los productos no son del Marketplace." };
    ordenId = await ordenDeLaFactura(devolucion.factura_numero);
  }

  // quien decidio: el evento de la decision en el historial (el supervisor se guarda con su codigo; el cajero con su usuario)
  const evento = [...devolucion.historial].reverse().find((h) => h.estado_nuevo === (decision === "RECHAZADA" ? "RECHAZADA" : "APROBADA"));
  const decididaEn = evento?.cambiado_en || devolucion.autorizado_en || new Date();
  const supervisorUsuario = evento?.cambiado_por || devolucion.autorizado_por || null;
  const nombres = await resolverNombres({ cajeros: [devolucion.cajero], supervisores: [supervisorUsuario] });
  const payload = armarMensajeDecision({
    devolucion,
    decision,
    ordenId,
    supervisor: { usuario: supervisorUsuario, nombre: nombres.supervisores.get(supervisorUsuario) ?? null },
    cajero: { usuario: devolucion.cajero, nombre: nombres.cajeros.get(devolucion.cajero) ?? null },
    decididaEn,
  });

  const { rows: dev } = await query(`SELECT id FROM devoluciones.devoluciones WHERE codigo = $1`, [devolucion.codigo]);
  const devolucionId = Number(dev[0].id);
  // una sola vez por decision: si ya existe el envio no se publica de nuevo
  const { rows: ya } = await query(`SELECT id, estado, pubsub_message_id FROM devoluciones.envios_marketplace_decision WHERE devolucion_id = $1 AND decision = $2`, [devolucionId, decision]);
  if (ya[0] && ya[0].estado === "Enviado") return { publicado: true, yaEnviado: true, messageId: ya[0].pubsub_message_id };

  const r = await publicar(
    payload,
    {
      tipo: "DECISION_DEVOLUCION",
      tipo_operacion: payload.tipo_operacion,
      referencia_externa: payload.referencia_externa,
      orden_id: ordenId,
      resultado: payload.datos.resultado,
      idempotency_key: `${payload.referencia_externa}-${decision}`,
      origen: "devoluciones",
      grupo: contabilidad.GRUPO_ORIGEN,
    },
    { topico: t, variable: VARIABLE }
  );
  await registrarEnvio({ servicio: "devoluciones", tipo: "DECISION_DEVOLUCION", referencia: payload.referencia_externa, topico: t, origen: contabilidad.GRUPO_ORIGEN, payload, ok: r.ok, messageId: r.messageId, error: r.error, por: supervisorUsuario });
  await query(
    `INSERT INTO devoluciones.envios_marketplace_decision (devolucion_id, decision, estado, pubsub_message_id, error, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (devolucion_id, decision) DO UPDATE SET estado = EXCLUDED.estado, pubsub_message_id = EXCLUDED.pubsub_message_id, error = EXCLUDED.error, payload = EXCLUDED.payload, enviado_en = now()`,
    [devolucionId, decision, r.ok ? "Enviado" : "Error", r.ok ? r.messageId : null, r.ok ? null : r.error, JSON.stringify(payload)]
  );
  return r.ok ? { publicado: true, messageId: r.messageId } : { publicado: false, error: r.error };
}

/** Nunca hace fallar la aprobacion o el rechazo: si algo sale mal lo informa en { error } y queda en el registro. */
async function avisarDecisionSegura(codigo) {
  try {
    return await avisarDecision(codigo);
  } catch (e) {
    console.error(`[marketplace] No se pudo avisar la decision de la devolucion ${codigo}:`, e.message);
    return { publicado: false, error: e.message };
  }
}

module.exports = { avisarDecision, avisarDecisionSegura, armarMensajeDecision, usarTopicoDePrueba };
