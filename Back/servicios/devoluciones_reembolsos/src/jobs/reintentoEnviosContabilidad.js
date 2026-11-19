// TDSI-93: cada 60 s reintenta los envios de notas de credito a Contabilidad que no llegaron a publicarse.
// Los envios que fallan por un problema pasajero (red, Pub/Sub caido) quedan "Pendiente" con la hora de su proximo intento;
// este proceso toma los que ya les toca y los vuelve a publicar con espera creciente (30 s, 60 s, 120 s, ...). Tras
// CONTABILIDAD_MAX_INTENTOS (5) intentos quedan en "Error" y el administrador los reenvia a mano (TDSI-95).
const repo = require("../data/enviosContabilidadRepo");
const { intentarEnvio } = require("../services/contabilidadService");
const cfg = require("../config/contabilidad");

let enCurso = false;

/**
 * Una pasada: toma los envios Pendientes cuya hora de reintento ya paso (SKIP LOCKED: dos procesos nunca toman el mismo)
 * e intenta publicarlos. Devuelve [{ id, estado, intentos }] con lo que paso con cada uno.
 */
async function reintentarPendientes({ limite = 10 } = {}) {
  if (enCurso || !cfg.PUBSUB_TOPIC) return [];
  enCurso = true;
  const resultados = [];
  try {
    for (const envio of await repo.tomarPendientes(limite)) {
      try {
        const r = await intentarEnvio(envio);
        resultados.push({ id: r.id, estado: r.estado, intentos: r.intentos });
        console.log(`[contabilidad] Reintento de la nota ${r.nota_numero}: ${r.estado} (intento ${r.intentos}/${cfg.MAX_INTENTOS})`);
      } catch (e) {
        // un fallo inesperado en uno no frena a los demas; queda con su proximo_intento_en y se retoma
        console.error(`[contabilidad] No se pudo reintentar el envio ${envio.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error("[contabilidad] No se pudieron tomar los envios pendientes:", e.message);
  } finally {
    enCurso = false;
  }
  return resultados;
}

/** Arranca el proceso periodico. Devuelve una funcion para detenerlo. */
function iniciar({ intervaloSeg = cfg.INTERVALO_WORKER_SEG } = {}) {
  if (!cfg.PUBSUB_TOPIC) return () => {};
  const timer = setInterval(reintentarPendientes, intervaloSeg * 1000);
  timer.unref?.();
  console.log(`[contabilidad] Reintentando envios pendientes cada ${intervaloSeg} s (hasta ${cfg.MAX_INTENTOS} intentos)`);
  return () => clearInterval(timer);
}

module.exports = { iniciar, reintentarPendientes };
