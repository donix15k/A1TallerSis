const { Router } = require("express");
const kpi = require("../services/kpiService");
const objetivos = require("../services/kpiObjetivosService");
const { requireAdministrador } = require("../middlewares/requireAdministrador");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// El Panel de KPIs es solo del administrador (Bearer token validado contra Gestion de Caja): 401 sin token, 403 si no es administrador.
router.use(requireAdministrador);

// TDSI-138: resumen del mes (?periodo=AAAA-MM, hora de Bolivia; sin periodo = mes actual) con las tarjetas KPI, hoy el ticket promedio
// y su color (VERDE >= Bs 45, AMARILLO Bs 35 - 44,99, ROJO < Bs 35).
router.get("/resumen", wrap(async (req, res) => {
  res.json({ ok: true, data: await kpi.resumen({ periodo: req.query.periodo, token: req.tokenAdministrador }) });
}));

// TDSI-139: ventas de cada dia de los ultimos 30 dias del periodo (dias sin ventas en 0) y la meta diaria, para el grafico
// "Ventas diarias vs meta". ?periodo=AAAA-MM (sin periodo = mes actual).
router.get("/ventas-vs-meta", wrap(async (req, res) => {
  res.json({ ok: true, data: await kpi.ventasVsMeta({ periodo: req.query.periodo }) });
}));

// TDSI-150: pestaña Riesgo: tasa de anulacion (VERDE <= 2 %, AMARILLO 2-5 %, ROJO > 5 %) y tasa de devoluciones = monto devuelto / monto
// vendido x 100 (VERDE <= 1,5 %, AMARILLO 1,5-3 %, ROJO > 3 %), con el desglose de motivos. ?periodo=AAAA-MM.
router.get("/riesgo", wrap(async (req, res) => {
  res.json({ ok: true, data: await kpi.riesgo({ periodo: req.query.periodo, token: req.tokenAdministrador }) });
}));

// TDSI-151: cuadro "Anulaciones por cajero": cajero, cantidad anulada y % del total, de mayor a menor. ?periodo=AAAA-MM.
router.get("/anulaciones/por-cajero", wrap(async (req, res) => {
  res.json({ ok: true, data: await kpi.anulacionesPorCajero({ periodo: req.query.periodo }) });
}));

// TDSI-190/191: los objetivos del semaforo (limite verde, amarillo y rojo y sentido de cada uno de los 7 KPIs). Los demas servicios de
// KPIs (Caja, Facturacion, Pagos a Proveedores) los leen de aqui para pintar sus colores con los mismos rangos.
router.get("/objetivos", wrap(async (req, res) => {
  res.json({ ok: true, data: { indicadores: await objetivos.listarObjetivos() } });
}));

module.exports = router;
