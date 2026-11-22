const { Router } = require("express");
const integraciones = require("../services/integracionesService");
const { requireAdministrador } = require("../middlewares/requireAdministrador");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// TDSI-126: los envios de Devoluciones a Contabilidad, Compras y Marketplace en el formato comun del Monitor de integraciones
// (lo consulta Gestion de Pagos con el token del administrador).
// Lee ahora mismo las respuestas de Contabilidad (notas de credito) de la suscripcion de A1, sin esperar el reloj de 30 s.
router.post("/respuestas-contabilidad/procesar", requireAdministrador, wrap(async (req, res) => {
  const r = await require("../jobs/respuestasContabilidad").procesarRespuestas();
  res.json({ ok: true, procesadas: r.length });
}));

router.get("/mensajes", requireAdministrador, wrap(async (req, res) => {
  const data = await integraciones.listarMensajes();
  res.json({ ok: true, total: data.length, data });
}));

// TDSI-129: reenvia un envio en Error (id "contabilidad-12", "compras-7", "marketplace-3").
router.post("/mensajes/:id/reenviar", requireAdministrador, wrap(async (req, res) => {
  const data = await integraciones.reenviarMensaje(req.params.id);
  res.json({ ok: true, mensaje: data.estado === "Error" ? "El reenvío volvió a fallar" : "Mensaje reenviado", data });
}));

module.exports = router;
