const { Router } = require("express");
const devolucionService = require("../services/devolucionService");
const reembolsoService = require("../services/reembolsoService");
const notaCreditoService = require("../services/notaCreditoService");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// TDSI-20: motivos activos (Producto defectuoso, Producto equivocado, Cliente se arrepintio, Otro).
router.get("/motivos", wrap(async (req, res) => {
  res.json({ ok: true, data: await devolucionService.listarMotivos() });
}));

// TDSI-12: el cajero busca una factura por su numero y ve que productos puede devolver el cliente.
router.get("/factura/:numero", wrap(async (req, res) => {
  const data = await devolucionService.consultarFacturaParaDevolucion(req.params.numero);
  res.json({ ok: true, data });
}));

// TDSI-21/22: valida los productos y cantidades contra la factura, calcula el monto (TOTAL o PARCIAL),
// genera el codigo DEV-0001 y guarda la devolucion en estado PENDIENTE.
router.post("/", wrap(async (req, res) => {
  const data = await devolucionService.registrarDevolucion(req.body);
  res.status(201).json({ ok: true, mensaje: "Devolución registrada", data });
}));

// TDSI-33: bandeja de devoluciones (?estado=PENDIENTE para la bandeja del supervisor) con su contador.
router.get("/", wrap(async (req, res) => {
  const { total, filas, pagina, por_pagina, total_paginas } = await devolucionService.listarDevoluciones(req.query);
  res.json({ ok: true, total, ...(pagina ? { pagina, por_pagina, total_paginas } : {}), data: filas });
}));

// TDSI-35: el supervisor aprueba una devolucion pendiente con su usuario y PIN ({ supervisor_id, pin }).
router.post("/:codigo/aprobar", wrap(async (req, res) => {
  const data = await devolucionService.aprobarDevolucion(req.params.codigo, req.body);
  res.json({ ok: true, mensaje: "Devolución aprobada", data });
}));

// TDSI-36: el supervisor rechaza una devolucion pendiente ({ supervisor_id, pin, motivo_rechazo >= 10 caracteres }).
router.post("/:codigo/rechazar", wrap(async (req, res) => {
  const data = await devolucionService.rechazarDevolucion(req.params.codigo, req.body);
  res.json({ ok: true, mensaje: "Devolución rechazada", data });
}));

// TDSI-49: reembolsa una devolucion APROBADA (efectivo de caja y/o reversion de tarjeta/QR) y la deja PROCESADA.
router.post("/:codigo/reembolsar", wrap(async (req, res) => {
  const data = await reembolsoService.reembolsar(req.params.codigo, req.body);
  res.status(201).json({ ok: true, mensaje: data.mensajes.join(". "), data });
}));

// TDSI-45: como se va a devolver el dinero de una devolucion APROBADA (segun como pago el cliente) y el monto.
router.get("/:codigo/reembolso", wrap(async (req, res) => {
  res.json({ ok: true, data: await reembolsoService.consultarReembolso(req.params.codigo, { forma: req.query.forma }) });
}));

// TDSI-58: nota de credito en PDF (empresa, factura original, productos devueltos y monto en letras).
router.get("/:codigo/nota-credito.pdf", wrap(async (req, res) => {
  const pdf = await notaCreditoService.generarPdf(req.params.codigo);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="nota-credito-${req.params.codigo}.pdf"`);
  res.send(pdf);
}));

// TDSI-80: historial de estados (linea de tiempo): quien registro, quien aprobo o rechazo y cuando se reembolso.
router.get("/:codigo/historial", wrap(async (req, res) => {
  res.json({ ok: true, data: await devolucionService.obtenerHistorial(req.params.codigo) });
}));

// TDSI-60: la nota de credito con su estado de envio (enviada_por_correo, enviada_en, a que correo).
router.get("/:codigo/nota-credito", wrap(async (req, res) => {
  res.json({ ok: true, data: await notaCreditoService.consultarNota(req.params.codigo) });
}));

// TDSI-59: envia por correo el PDF de la nota de credito y registra el envio.
router.post("/:codigo/nota-credito/enviar", wrap(async (req, res) => {
  const data = await notaCreditoService.enviarPorCorreo(req.params.codigo, req.body);
  res.status(201).json({
    ok: true,
    mensaje: data.estado === "SIMULADO" ? `Envío simulado a ${data.email} (el servidor no tiene correo configurado)` : `Nota de crédito enviada a ${data.email}`,
    data,
  });
}));

// TDSI-24: estado, items, motivo y monto de una devolucion por su codigo. Va al final: "motivos" y
// "factura/:numero" son rutas fijas y no deben confundirse con un codigo.
router.get("/:codigo", wrap(async (req, res) => {
  res.json({ ok: true, data: await devolucionService.obtenerDevolucion(req.params.codigo) });
}));

module.exports = router;
