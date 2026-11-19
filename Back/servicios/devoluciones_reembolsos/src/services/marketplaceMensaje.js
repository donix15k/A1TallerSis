// TDSI-117: el aviso DEVOLUCION_RESUELTA para el Marketplace (Grupo E), en el sobre del grupo.
const { SISTEMA_ORIGEN } = require("./comprasMensaje");

const num = (v) => Math.round(Number(v || 0) * 100) / 100;
const fechaBolivia = (v) => new Date(v).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });

/**
 * Arma el mensaje del resultado de una devolucion de un pedido online:
 *   - "aprobada": con el monto reembolsado y el N° de la nota de credito;
 *   - "rechazada": con el motivo del rechazo y monto reembolsado 0.
 * referencia_externa = codigo de la devolucion; la orden del pedido va en datos.orden_id.
 */
function armarMensajeDevolucionResuelta({ devolucion, resultado, notaNumero = null, resueltaEn = new Date() }) {
  const aprobada = resultado === "APROBADA";
  return {
    sistema_origen: SISTEMA_ORIGEN,
    referencia_externa: devolucion.codigo,
    tipo_operacion: "devolucion_resuelta",
    fecha_documento: fechaBolivia(resueltaEn),
    datos: {
      orden_id: devolucion.orden_id,
      codigo_devolucion: devolucion.codigo,
      resultado: aprobada ? "aprobada" : "rechazada",
      monto_reembolsado: aprobada ? num(devolucion.monto_total) : 0,
      numero_nota_credito: aprobada ? notaNumero : null,
      motivo_rechazo: aprobada ? null : devolucion.motivo_rechazo || null,
      generado_en: new Date(resueltaEn).toISOString(),
    },
  };
}

module.exports = { armarMensajeDevolucionResuelta };
