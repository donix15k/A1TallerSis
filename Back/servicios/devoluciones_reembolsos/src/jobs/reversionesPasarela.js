// TDSI-48: cada cierto tiempo envia a la pasarela las reversiones pendientes (y reintenta las que fallaron).
const { procesarPendientes } = require("../services/reversionService");

/** Arranca el proceso. Devuelve una funcion para detenerlo. Nunca corren dos pasadas a la vez. */
function iniciar({ intervaloMs, log = console } = {}) {
  let enCurso = false;
  const pasada = async () => {
    if (enCurso) return;
    enCurso = true;
    try {
      const r = await procesarPendientes();
      if (r.enviados || r.fallidos) log.log(`[reversiones] enviadas: ${r.enviados}, con fallo: ${r.fallidos}, agotadas: ${r.agotados}`);
    } catch (e) {
      log.error("[reversiones] no se pudo procesar:", e.message);
    } finally {
      enCurso = false;
    }
  };
  const timer = setInterval(pasada, intervaloMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { iniciar };
