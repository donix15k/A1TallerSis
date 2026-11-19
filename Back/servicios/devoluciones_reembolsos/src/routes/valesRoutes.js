const { Router } = require("express");
const valeService = require("../services/valeService");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// TDSI-69: saldo disponible, estado (ACTIVO, USADO, EXPIRADO) y fecha de vencimiento de un vale.
router.get("/:codigo", wrap(async (req, res) => {
  res.json({ ok: true, data: await valeService.consultarVale(req.params.codigo) });
}));

module.exports = router;
