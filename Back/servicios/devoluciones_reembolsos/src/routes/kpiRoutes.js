const { Router } = require("express");
const kpi = require("../services/kpiService");
const { requireAdministrador } = require("../middlewares/requireAdministrador");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// TDSI-149: el monto devuelto del periodo (?periodo=AAAA-MM, hora de Bolivia) y el % de cada motivo, de mayor a menor. Solo
// administrador: lo consulta el Panel de KPIs (Gestion de Pagos reenvia el token).
router.get("/devoluciones", requireAdministrador, wrap(async (req, res) => {
  res.json({ ok: true, data: await kpi.devolucionesDelPeriodo({ periodo: req.query.periodo }) });
}));

// TDSI-180: los asientos de notas de credito enviados a Contabilidad en el periodo (enviados, registrados, rechazados y la lista de
// rechazados). Solo administrador: lo consulta Facturacion para armar la aceptacion contable del Panel de KPIs (reenvia el token).
router.get("/asientos-contables", requireAdministrador, wrap(async (req, res) => {
  res.json({ ok: true, data: await kpi.asientosContablesDelPeriodo({ periodo: req.query.periodo }) });
}));

module.exports = router;
