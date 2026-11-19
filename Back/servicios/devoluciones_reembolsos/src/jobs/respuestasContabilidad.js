const subscriber = require("../clients/pubsubSubscriber");
const { procesarMensaje } = require("../services/respuestasContabilidadService");
const { procesarMensaje: procesarAcuse } = require("../services/acusesComprasService");
const cfg = require("../config/contabilidad");

let enCurso = false;
let ultimoError = null;

/**
 * TDSI-94: lee la suscripcion de respuestas de Contabilidad (ucb-sis323-sub-a1-sub), guarda cada resultado_documento de
 * nuestras NOTAS DE CREDITO (N° de asiento o motivo del rechazo) y lo confirma (ack). Los demas mensajes (respuestas a
 * facturas, diferencias, etc.) se liberan sin confirmar, para no quitarselos a los otros servicios que leen esa suscripcion.
 */
async function procesarRespuestas() {
  if (enCurso || !cfg.RESPUESTAS_SUBSCRIPTION) return [];
  enCurso = true;
  const resultados = [];
  try {
    const mensajes = await subscriber.leer(50);
    const confirmar = [];
    const liberar = [];
    for (const m of mensajes) {
      try {
        // La suscripcion es compartida: primero se prueba como respuesta de Contabilidad a una nota (NC-) y, si no es,
        // como acuse de Compras a un aviso de devolucion (DEV-, TDSI-105).
        let r = await procesarMensaje(m);
        const esAcuse = !r.propio && (r = await procesarAcuse(m)).propio;
        (r.propio ? confirmar : liberar).push(m.ackId);
        if (r.propio) {
          resultados.push(r);
          if (esAcuse) console.log(`[compras] ${r.referencia} -> ${r.resultado}${r.envio.numero_reclamo ? ` (reclamo ${r.envio.numero_reclamo})` : ""}`);
          else console.log(`[contabilidad] ${r.referencia} -> ${r.resultado}${r.envio.numero_asiento ? ` (asiento ${r.envio.numero_asiento})` : ""}`);
        }
      } catch (e) {
        liberar.push(m.ackId); // se vuelve a intentar en la siguiente lectura
        console.error(`[contabilidad] No se pudo guardar la respuesta ${m.messageId}:`, e.message);
      }
    }
    await subscriber.confirmar(confirmar);
    await subscriber.liberar(liberar);
    ultimoError = null;
  } catch (e) {
    if (e.message !== ultimoError) console.error("[contabilidad] No se pudieron leer las respuestas:", e.message);
    ultimoError = e.message;
  } finally {
    enCurso = false;
  }
  return resultados;
}

function iniciar() {
  if (!cfg.RESPUESTAS_SUBSCRIPTION) return () => {};
  try {
    subscriber.nombreSuscripcion();
  } catch (e) {
    console.error(`[contabilidad] No se leen las respuestas: ${e.message}`); // configuracion invalida: el servicio sigue
    return () => {};
  }
  const timer = setInterval(procesarRespuestas, cfg.RESPUESTAS_INTERVALO_SEG * 1000);
  timer.unref();
  console.log(`[contabilidad] Leyendo respuestas de ${subscriber.nombreSuscripcion()} cada ${cfg.RESPUESTAS_INTERVALO_SEG} s`);
  return () => clearInterval(timer);
}

module.exports = { iniciar, procesarRespuestas };
