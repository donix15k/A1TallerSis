const { Router } = require("express");
const facturasRepo = require("../data/facturasRepo");
const facturasService = require("../services/facturasService");
const tirilla = require("../services/tirillaService");
const impresion = require("../services/impresoraService");
const documentos = require("../services/documentosService");
const contabilidad = require("../services/contabilidadService");
const respuestasAnulacionService = require("../services/respuestasAnulacionService");

const { requireAdministrador } = require("../middlewares/requireAdministrador");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.get("/", wrap(async (req, res) => res.json({ ok: true, data: await facturasRepo.listarFacturas() })));

// TDSI-22: al emitir la factura se publica su mensaje 'venta' para Contabilidad (Grupo D).
router.post("/", wrap(async (req, res) => {
  const factura = await facturasService.crearFactura(req.body);
  const envio = await contabilidad.enviarFacturaSeguro(factura.id, "venta");
  res.status(201).json({ ok: true, mensaje: "Factura creada", data: factura, contabilidad: envio });
}));

// TDSI-22: envios de facturas a Contabilidad
router.get("/envios-contabilidad", wrap(async (req, res) => {
  res.json({ ok: true, data: await contabilidad.listarEnvios(req.query) });
}));
router.post("/envios-contabilidad/:id/reenviar", wrap(async (req, res) => {
  const envio = await contabilidad.reenviarEnvio(req.params.id, { justificacion: req.body?.justificacion });
  const status = envio.estado === "Enviado" ? 200 : envio.estado === "Pendiente" ? 202 : 502;
  res.status(status).json({ ok: status !== 502, data: envio });
}));

// Lee ahora mismo las respuestas de Contabilidad (resultado_documento) de la suscripcion de A1, sin esperar el reloj de 30 s. Solo administrador.
router.post("/respuestas-contabilidad/procesar", requireAdministrador, wrap(async (req, res) => {
  const r = await require("../jobs/respuestasContabilidad").procesarRespuestas();
  res.json({ ok: true, procesadas: r.length });
}));

// Listado paginado y con busqueda (numero, cliente, NIT/CI) para las pantallas con muchas facturas: ?q=&pagina=&por_pagina=&numeros=F-1,F-2
router.get("/paginadas", wrap(async (req, res) => {
  const porPagina = Math.min(100, Math.max(1, Number.parseInt(req.query.por_pagina, 10) || 10));
  const pagina = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
  const numeros = String(req.query.numeros || "").split(",").map((n) => n.trim()).filter(Boolean).slice(0, 200);
  const q = String(req.query.q || "").trim().slice(0, 100) || null;
  const r = await facturasRepo.listarFacturasPaginadas({ q, numeros, limite: porPagina, offset: (pagina - 1) * porPagina });
  res.json({ ok: true, total: r.total, pagina, por_pagina: porPagina, total_paginas: Math.max(1, Math.ceil(r.total / porPagina)), data: r.filas });
}));

router.get("/impresora", wrap((req, res) => res.json({ ok: true, data: impresion.estadoImpresora() })));
router.patch("/impresora", wrap((req, res) => res.json({ ok: true, data: impresion.conmutarImpresora(req.body.conectada) })));

// =========================================================================
// TDSI-48: Rutas de respuestas de anulación (DEBEN IR ANTES DE "/:numero")
// =========================================================================
router.get("/respuestas-anulacion", wrap(async (req, res) => {
  const data = await respuestasAnulacionService.listar(req.query.cajero_id);
  res.json({ ok: true, data });
}));

router.post("/respuestas-anulacion", wrap(async (req, res) => {
  const data = await respuestasAnulacionService.crear(req.body);
  res.status(201).json({ ok: true, data });
}));

router.put("/respuestas-anulacion/:id", wrap(async (req, res) => {
  const data = await respuestasAnulacionService.actualizar(req.params.id, req.body.cajero_id, req.body);
  res.json({ ok: true, data });
}));

router.delete("/respuestas-anulacion/:id", wrap(async (req, res) => {
  const data = await respuestasAnulacionService.eliminar(req.params.id, req.query.cajero_id);
  res.json({ ok: true, data });
}));
// =========================================================================

// Rutas genéricas de facturas por número (van al final para no capturar las anteriores)
router.get("/:numero", wrap(async (req, res) => res.json({ ok: true, data: await tirilla.obtenerFactura(req.params.numero) })));
router.get("/:numero/tirilla", wrap(async (req, res) => {
  const t = await tirilla.generarTirilla(req.params.numero, { copia: req.query.copia === "true" });
  res.type("text/plain").send(t.texto);
}));
router.post("/:numero/imprimir", wrap(async (req, res) => res.json({ ok: true, data: await impresion.imprimir(req.params.numero) })));
router.post("/:numero/reimprimir", wrap(async (req, res) => res.json({ ok: true, data: await impresion.reimprimir(req.params.numero, req.body && req.body.motivo) })));

router.post("/:numero/enviar-contabilidad", wrap(async (req, res) => {
  const factura = await facturasRepo.obtenerFacturaCompleta(req.params.numero);
  if (!factura) return res.status(404).json({ ok: false, mensaje: "Factura no encontrada" });
  const envio = await contabilidad.enviarFactura(factura.id, (req.body && req.body.tipo) || "venta");
  res.json({ ok: true, data: envio });
}));

router.get("/:numero/documentos", wrap(async (req, res) => {
  res.json({ ok: true, data: await documentos.obtenerEstadoDocumentos(req.params.numero) });
}));

router.get("/:numero/documentos/:tipo", wrap(async (req, res) => {
  const { archivo, contentType, nombreArchivo } = await documentos.obtenerArchivoParaEntrega(req.params.numero, req.params.tipo);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
  res.send(archivo);
}));

module.exports = router;