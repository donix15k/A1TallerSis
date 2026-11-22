const subscriber = require("../clients/pubsubSubscriber");
const { procesarMensaje } = require("../services/ordenesComprasPubSubService");
const { registrarRecepcion } = require("../utils/pubsubLog");
const cfg = require("../config/integraciones");

let enCurso = false;
let ultimoError = null;

/**
 * Lee la suscripcion de A1 y guarda las ordenes de pago que Compras mando por Pub/Sub (las confirma con ack). Todo lo demas se libera sin
 * confirmar, para que lo lea quien le toque. Cada orden recibida queda en el registro unico de Pub/Sub (quien la mando, cuando, messageId).
 */
async function procesarOrdenes() {
  if (enCurso || !cfg.ORDENES_SUBSCRIPTION) return [];
  enCurso = true;
  const resultados = [];
  try {
    const suscripcion = subscriber.nombreSuscripcion();
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
        resultados.push(r);
        const estado = !r.ok ? `invalida (${r.error})` : r.duplicada ? "ya estaba registrada" : "PENDIENTE";
        await registrarRecepcion({
          servicio: "pagos_proveedores", tipo: "ORDEN_PAGO", referencia: r.referencia, origen: "C", payload: r.payload, messageId: m.messageId,
          ok: r.ok, error: r.ok ? null : r.error, mensaje: `Orden de pago de Compras ${r.referencia}: ${estado}`,
        });
        console.log(`[compras] Orden ${r.referencia} -> ${estado}`);
      } catch (e) {
        liberar.push(m.ackId); // se vuelve a intentar en la siguiente lectura
        console.error(`[compras] No se pudo procesar la orden ${m.messageId}:`, e.message);
      }
    }
    await subscriber.confirmar(confirmar, suscripcion);
    await subscriber.liberar(liberar, suscripcion);
    ultimoError = null;
  } catch (e) {
    if (e.message !== ultimoError) console.error("[compras] No se pudieron leer las ordenes:", e.message);
    ultimoError = e.message;
  } finally {
    enCurso = false;
  }
  return resultados;
}

function iniciar() {
  if (!cfg.ORDENES_SUBSCRIPTION) return;
  let suscripcion;
  try {
    suscripcion = subscriber.nombreSuscripcion();
  } catch (e) {
    console.error(`[compras] No se leen las ordenes: ${e.message}`); // configuracion invalida: el servicio sigue
    return;
  }
  const timer = setInterval(procesarOrdenes, cfg.ORDENES_INTERVALO_SEG * 1000);
  timer.unref();
  console.log(`[compras] Leyendo ordenes de pago de ${suscripcion} cada ${cfg.ORDENES_INTERVALO_SEG} s`);
}

module.exports = { iniciar, procesarOrdenes };
