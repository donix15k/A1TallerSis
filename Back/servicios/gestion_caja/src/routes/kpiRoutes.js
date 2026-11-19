const { Router } = require("express");
const { cumplimientoMetas } = require("../services/kpiMetasService");
const { cuadreCaja } = require("../services/kpiCuadreService");
const { asientosContablesDelPeriodo } = require("../services/kpiAsientosService");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// TDSI-159: KPI 4 · cumplimiento de metas del mes (?periodo=AAAA-MM): vendido, meta, % y color de cada caja y el % general.
// Se monta detras de requireAdministrador (solo el administrador ve el Panel de KPIs).
router.get("/cumplimiento-metas", wrap(async (req, res) => {
  res.json({ ok: true, data: await cumplimientoMetas({ periodo: req.query.periodo, token: req.tokenAdministrador }) });
}));

// TDSI-169/170/171: KPI 5 · efectividad de cuadre del mes (?periodo=AAAA-MM&ultimos=5): turnos cerrados y que cuadran, %, color,
// sobrantes y faltantes en Bs, turnos con diferencia y ultimos turnos cerrados.
router.get("/cuadre-caja", wrap(async (req, res) => {
  res.json({ ok: true, data: await cuadreCaja({ periodo: req.query.periodo, ultimos: req.query.ultimos, token: req.tokenAdministrador }) });
}));

// TDSI-180: los asientos de diferencias de caja enviados a Contabilidad en el periodo (enviados, registrados, rechazados y la lista de
// rechazados). Lo consulta Facturacion para armar la aceptacion contable del Panel de KPIs.
router.get("/asientos-contables", wrap(async (req, res) => {
  res.json({ ok: true, data: await asientosContablesDelPeriodo({ periodo: req.query.periodo }) });
}));

module.exports = router;
