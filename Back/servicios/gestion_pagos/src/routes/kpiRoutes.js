const { Router } = require("express");
const kpi = require("../services/kpiService");
const objetivos = require("../services/kpiObjetivosService");
const alertasService = require("../services/kpiAlertasService");
const reporteService = require("../services/kpiReporteService");
const { generarReportePdf } = require("../services/kpiReportePdfService");
const { generarReporteExcel } = require("../services/kpiReporteExcelService");
const { requireAdministrador } = require("../middlewares/requireAdministrador");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// TDSI-219: los rangos del semaforo (verde / amarillo / rojo de cada KPI) se pueden LEER sin ser administrador: no son datos sensibles y
// la pantalla "Mi turno" del cajero pinta su meta de hoy con los mismos rangos que el panel. Cambiarlos sigue siendo solo del administrador.
router.get("/semaforo", wrap(async (req, res) => {
  const lista = await objetivos.listarObjetivos();
  res.json({ ok: true, data: { indicadores: lista.map(({ indicador, nombre, unidad, verde, amarillo, rojo, sentido }) => ({ indicador, nombre, unidad, verde, amarillo, rojo, sentido })) } });
}));

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
// TDSI-200: con las metas mensuales de las cajas (los demas servicios piden ?metas=no: solo necesitan los limites).
router.get("/objetivos", wrap(async (req, res) => {
  const conMetas = String(req.query.metas ?? "").toLowerCase() !== "no";
  res.json({ ok: true, data: await objetivos.configuracion({ token: req.tokenAdministrador, conMetas }) });
}));

// TDSI-201/202: "Guardar" de "Configurar objetivos": limites de los KPIs ({ indicadores: [{ indicador, verde, amarillo, rojo }] }) y meta
// mensual de cada caja ({ metas_cajas: [{ caja_id, monto_mensual }] }). Valida (amarillo entre verde y rojo, porcentajes de 0 a 100,
// metas > 0) y es todo o nada; 400 con los errores por campo. Solo administrador (router.use(requireAdministrador) de arriba).
router.put("/objetivos", wrap(async (req, res) => {
  const quien = req.administrador ? req.administrador.nombre || req.administrador.administrador_id : null;
  const data = await objetivos.guardarObjetivos({ indicadores: req.body?.indicadores, metas_cajas: req.body?.metas_cajas, actualizado_por: quien, token: req.tokenAdministrador });
  res.json({ ok: true, mensaje: "Objetivos guardados", data });
}));

// TDSI-192: "Alertas del dia" del Resumen: KPIs, cajas, ordenes vencidas y asientos rechazados fuera de lo esperado, primero las ROJAS
// y luego las AMARILLAS (?periodo=AAAA-MM). Reenvia el token del administrador a los demas servicios de KPIs.
router.get("/alertas", wrap(async (req, res) => {
  res.json({ ok: true, data: await alertasService.alertas({ periodo: req.query.periodo, token: req.tokenAdministrador }) });
}));

// TDSI-209/210/211/212: exportar el Panel de KPIs a PDF o Excel. ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD (un mes completo; o ?periodo=AAAA-MM) y
// ?secciones=resumen,cajas,integraciones (al menos una). El archivo se llama KPIs_[periodo] y los valores salen de los MISMOS servicios de
// calculo del panel. Content-Disposition va expuesto para que el Frontend (otro origen) lea el nombre del archivo.
const TIPOS = {
  pdf: { mime: "application/pdf", generar: (modelo) => generarReportePdf(modelo) },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", generar: (modelo) => generarReporteExcel(modelo) },
};
for (const [extension, tipo] of Object.entries(TIPOS)) {
  router.get(`/exportar.${extension}`, wrap(async (req, res) => {
    const modelo = await reporteService.construirReporte({ desde: req.query.desde, hasta: req.query.hasta, periodo: req.query.periodo, secciones: req.query.secciones, token: req.tokenAdministrador });
    const archivo = Buffer.from(await tipo.generar(modelo));
    res.set({
      "Content-Type": tipo.mime,
      "Content-Disposition": `attachment; filename="${modelo.nombre_archivo}.${extension}"`,
      "Content-Length": String(archivo.length),
      "Access-Control-Expose-Headers": "Content-Disposition",
      "Cache-Control": "no-store",
    });
    res.end(archivo);
  }));
}

module.exports = router;
