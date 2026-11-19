const { Router } = require("express");
const { diasPagoProveedores } = require("../services/kpiDiasPagoService");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// TDSI-181/182: KPI 7 · dias promedio de pago a proveedores del mes (?periodo=AAAA-MM&limite=20): promedio y color (VERDE <= 7,
// AMARILLO 8-15, ROJO > 15), ordenes vencidas (mas de 15 dias sin pagar) y ordenes pagadas. Se monta detras de requireAdministrador.
router.get("/dias-pago-proveedores", wrap(async (req, res) => {
  res.json({ ok: true, data: await diasPagoProveedores({ periodo: req.query.periodo, limite: req.query.limite }) });
}));

module.exports = router;
