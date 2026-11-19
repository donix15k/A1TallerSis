const { Router } = require("express");
const integraciones = require("../services/integracionesService");
const { requireAdministrador } = require("../middlewares/requireAdministrador");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// Todo el Monitor de integraciones es solo del administrador (Bearer token validado contra Gestion de Caja).
router.use(requireAdministrador);

// TDSI-126: los mensajes enviados a otros grupos por todos los microservicios (grupo, tipo, fecha, estado y messageId).
router.get("/mensajes", wrap(async (req, res) => {
  const { total, fuentes, data } = await integraciones.listarMensajes({ token: req.tokenAdministrador });
  res.json({ ok: true, total, fuentes, data });
}));

module.exports = router;
