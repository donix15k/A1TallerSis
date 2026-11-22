const subscriber = require("../clients/pubsubSubscriber");
const { registrarRecepcion, parsear } = require("../utils/pubsubLog");
const { procesarMensaje } = require("../services/solicitudesMarketplaceService");
const erroresRepo = require("../data/marketplaceErroresRepo");
const cfg = require("../config/marketplace");

let enCurso = false;
let ultimoError = null;

/** Un error pasajero (Gestion de Pagos o la base caidas) no invalida la solicitud: se reintenta en la siguiente lectura. */
const esPasajero = (e) => !e.status || e.status >= 500;

/**
 * TDSI-113: cada 30 s lee de nuestra suscripcion (ucb-sis323-sub-a1-sub) los mensajes SOLICITUD_DEVOLUCION del Marketplace y
 * registra cada uno como devolucion PENDIENTE (TDSI-114).
 *   - solicitud valida (o repetida) -> se registra y se CONFIRMA (ack);
 *   - solicitud invalida (mal formada, orden inexistente, fuera de plazo...) -> se guarda con su error en la tabla de revision
 *     (TDSI-115) y tambien se CONFIRMA: nunca se va a poder procesar, reintentarla no sirve;
 *   - error pasajero (Gestion de Pagos o la base no responden) -> se libera sin confirmar para reintentarla despues;
 *   - cualquier otro mensaje de la suscripcion compartida (respuestas de Contabilidad, acuses de Compras...) -> se libera
 *     sin confirmar, para no quitarselo a quien le toque.
 */
async function procesarSolicitudes() {
  if (enCurso || !cfg.SOLICITUDES_SUBSCRIPTION) return [];
  enCurso = true;
  const resultados = [];
  try {
    const suscripcion = subscriber.nombreSuscripcion(cfg.SOLICITUDES_SUBSCRIPTION);
    const mensajes = await subscriber.leer(50, suscripcion);
    const confirmar = [];
    const liberar = [];
    for (const m of mensajes) {
      try {
        const r = await procesarMensaje(m);
        if (!r.propio) {
          liberar.push(m.ackId);
          continue;
        }
        confirmar.push(m.ackId);
        await registrarRecepcion({ servicio: "devoluciones", tipo: "SOLICITUD_DEVOLUCION", referencia: r.solicitud.orden_id, origen: "E", payload: parsear(m.texto), messageId: m.messageId, mensaje: `Solicitud de devolución del Marketplace: orden ${r.solicitud.orden_id} -> ${r.resultado.codigo}` });
        resultados.push({ ...r.resultado, orden_id: r.solicitud.orden_id });
        console.log(`[marketplace] Solicitud de la orden ${r.solicitud.orden_id} -> ${r.resultado.duplicada ? "ya estaba registrada como" : "devolucion"} ${r.resultado.codigo}`);
      } catch (e) {
        if (esPasajero(e)) {
          liberar.push(m.ackId);
          console.error(`[marketplace] No se pudo procesar ${m.messageId} ahora, se reintenta:`, e.message);
          continue;
        }
        await erroresRepo.registrar({ messageId: m.messageId, error: e.message, payload: m.texto });
        await registrarRecepcion({ servicio: "devoluciones", tipo: "SOLICITUD_DEVOLUCION", origen: "E", payload: parsear(m.texto), messageId: m.messageId, ok: false, error: e.message, mensaje: "Solicitud de devolución inválida" });
        confirmar.push(m.ackId);
        console.error(`[marketplace] Solicitud ${m.messageId} invalida, se guardo el error:`, e.message);
      }
    }
    await subscriber.confirmar(confirmar, suscripcion);
    await subscriber.liberar(liberar, suscripcion);
    ultimoError = null;
  } catch (e) {
    if (e.message !== ultimoError) console.error("[marketplace] No se pudieron leer las solicitudes:", e.message);
    ultimoError = e.message;
  } finally {
    enCurso = false;
  }
  return resultados;
}

/** Arranca la lectura periodica. Devuelve una funcion para detenerla. */
function iniciar() {
  if (!cfg.SOLICITUDES_SUBSCRIPTION) return () => {};
  let suscripcion;
  try {
    suscripcion = subscriber.nombreSuscripcion(cfg.SOLICITUDES_SUBSCRIPTION);
  } catch (e) {
    console.error(`[marketplace] No se leen las solicitudes: ${e.message}`); // configuracion invalida: el servicio sigue
    return () => {};
  }
  const timer = setInterval(procesarSolicitudes, cfg.SOLICITUDES_INTERVALO_SEG * 1000);
  timer.unref();
  console.log(`[marketplace] Leyendo solicitudes de devolucion de ${suscripcion} cada ${cfg.SOLICITUDES_INTERVALO_SEG} s`);
  return () => clearInterval(timer);
}

module.exports = { iniciar, procesarSolicitudes, esPasajero };
