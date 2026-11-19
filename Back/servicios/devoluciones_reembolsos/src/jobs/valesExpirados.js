// TDSI-71: tarea diaria que marca EXPIRADO los vales vencidos (corre al arrancar y luego cada VALES_JOB_INTERVALO_HORAS).
const { expirarVencidos } = require("../services/valeService");

/** Arranca la tarea. Devuelve una funcion para detenerla. */
function iniciar({ intervaloMs, log = console } = {}) {
  const pasada = async () => {
    try {
      const n = await expirarVencidos();
      if (n) log.log(`[vales] marcados como EXPIRADOS: ${n}`);
    } catch (e) {
      log.error("[vales] no se pudo marcar los vencidos:", e.message);
    }
  };
  pasada();
  const timer = setInterval(pasada, intervaloMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { iniciar };
