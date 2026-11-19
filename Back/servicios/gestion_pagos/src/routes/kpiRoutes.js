const { Router } = require("express");
const kpi = require("../services/kpiService");
const { requireAdministrador } = require("../middlewares/requireAdministrador");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// El Panel de KPIs es solo del administrador (Bearer token validado contra Gestion de Caja): 401 sin token, 403 si no es administrador.
router.use(requireAdministrador);

// TDSI-138: resumen del mes (?periodo=AAAA-MM, hora de Bolivia; sin periodo = mes actual) con las tarjetas KPI, hoy el ticket promedio
// y su color (VERDE >= Bs 45, AMARILLO Bs 35 - 44,99, ROJO < Bs 35).
router.get("/resumen", wrap(async (req, res) => {
  res.json({ ok: true, data: await kpi.resumen({ periodo: req.query.periodo }) });
}));

// TDSI-139: ventas de cada dia de los ultimos 30 dias del periodo (dias sin ventas en 0) y la meta diaria, para el grafico
// "Ventas diarias vs meta". ?periodo=AAAA-MM (sin periodo = mes actual).
router.get("/ventas-vs-meta", wrap(async (req, res) => {
  res.json({ ok: true, data: await kpi.ventasVsMeta({ periodo: req.query.periodo }) });
}));

module.exports = router;
