const { Router } = require("express");
const simulacion = require("../services/simulacionService");
const espejo = require("../services/espejoTopicosService");
const { reunirMensajes } = require("../services/integracionesService");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const quien = (req) => (req.administrador ? req.administrador.nombre || req.administrador.administrador_id : null);

// Simulacion de los otros grupos (Contabilidad, Marketplace, Compras). Se monta detras de requireAdministrador: cada accion publica UN
// mensaje real por Pub/Sub al topico de entrada de A1, con la identidad del grupo de la vista.

// Que grupo es la vista y por que topicos viaja lo que se envia (en la vista simulada y en la normal).
router.get("/vistas/:vista", wrap(async (req, res) => {
  res.json({ ok: true, data: simulacion.contexto(req.params.vista) });
}));

// ---- Contabilidad
router.get("/contabilidad/documentos", wrap(async (req, res) => {
  res.json({ ok: true, data: await simulacion.documentosContabilidad({ reunirMensajes, token: req.tokenAdministrador }) });
}));
router.get("/contabilidad/detalle", wrap(async (req, res) => {
  res.json({ ok: true, data: await simulacion.detalleDocumentoContabilidad({ referencia: req.query.referencia, reunirMensajes, token: req.tokenAdministrador }) });
}));
router.post("/contabilidad/responder", wrap(async (req, res) => {
  const data = await simulacion.responderContabilidad({ ...req.body, enviado_por: quien(req) });
  res.status(201).json({ ok: true, mensaje: "Respuesta publicada en Pub/Sub", data });
}));

// ---- Marketplace
router.get("/marketplace/productos", wrap(async (req, res) => {
  res.json({ ok: true, data: simulacion.listarProductosMarketplace() });
}));
router.get("/marketplace/ventas", wrap(async (req, res) => {
  res.json({ ok: true, data: await simulacion.ventasMarketplaceRecientes() });
}));
router.post("/marketplace/ventas", wrap(async (req, res) => {
  // en cuanto Pub/Sub guarda el mensaje se lee la suscripcion, para que la venta aparezca sin esperar el reloj del job
  const alPublicar = () => setTimeout(() => require("../jobs/marketplaceVentas").procesarVentas().catch(() => {}), 2500).unref();
  const data = await simulacion.enviarVentaMarketplace({ ...req.body, enviado_por: quien(req), alPublicar });
  res.status(201).json({ ok: true, mensaje: "Venta publicada en Pub/Sub", data });
}));

// ---- Compras
router.get("/compras/reportes", wrap(async (req, res) => {
  res.json({ ok: true, data: await simulacion.reportesCompras() });
}));
router.post("/compras/acuse", wrap(async (req, res) => {
  const alPublicar = () => setTimeout(() => require("../jobs/acusesCompras").procesarAcuses().catch(() => {}), 2500).unref();
  const data = await simulacion.acusarCompras({ reporte_id: req.body.reporte_id, enviado_por: quien(req), alPublicar });
  res.status(201).json({ ok: true, mensaje: "Acuse publicado en Pub/Sub", data });
}));
router.get("/compras/proveedores", wrap(async (req, res) => {
  res.json({ ok: true, data: simulacion.listarProveedores() });
}));
router.get("/compras/ordenes", wrap(async (req, res) => {
  res.json({ ok: true, data: await simulacion.ordenesPendientesCompras() });
}));
router.post("/compras/ordenes", wrap(async (req, res) => {
  const data = await simulacion.enviarOrdenCompras({ ...req.body, enviado_por: quien(req) });
  res.status(201).json({ ok: true, mensaje: "Orden de pago entregada a Pagos a Proveedores", data });
}));

// ---- Espejo de topicos: leer lo que llega a un topico de cualquier grupo (suscripcion propia, de vida corta)
router.post("/espejo/:grupo/activar", wrap(async (req, res) => {
  res.json({ ok: true, data: await espejo.activar(req.params.grupo) });
}));
router.post("/espejo/:grupo/leer", wrap(async (req, res) => {
  res.json({ ok: true, data: await espejo.leer(req.params.grupo) });
}));
router.delete("/espejo/:grupo", wrap(async (req, res) => {
  res.json({ ok: true, data: await espejo.desactivar(req.params.grupo) });
}));

module.exports = router;
