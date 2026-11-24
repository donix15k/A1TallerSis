const { Router } = require("express");
const devolucionService = require("../services/devolucionService");
const reembolsoService = require("../services/reembolsoService");
const notaCreditoService = require("../services/notaCreditoService");
const exportacionService = require("../services/exportacionService");
const contabilidadService = require("../services/contabilidadService");
const { estadoVisible } = require("../data/enviosContabilidadRepo");
const { requireAdministrador, requireAdministradorSalvoBandeja } = require("../middlewares/requireAdministrador");

const marketplaceService = require("../services/marketplaceService");
const enviosComprasRepo = require("../data/enviosComprasRepo");
const enviosMarketplaceRepo = require("../data/enviosMarketplaceRepo");

/** Lo que se muestra del aviso al Marketplace: su estado (Pendiente, Enviado, Error) o null si no aplica (devolucion de la tienda). */
const resumenAviso = (a) => (a.estado ? { estado: a.estado, intentos: a.intentos, pubsub_message_id: a.pubsub_message_id } : null);

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

// "Nueva devolucion": las facturas con su codigo, si siguen dentro del plazo de 7 dias y si se pueden devolver (?q=&pagina=&por_pagina=).
router.get("/facturas", wrap(async (req, res) => {
  const r = await devolucionService.listarFacturasParaDevolucion(req.query);
  res.json({ ok: true, total: r.total, pagina: r.pagina, por_pagina: r.por_pagina, total_paginas: r.total_paginas, data: r.filas });
}));

// Las devoluciones mas recientes primero, 10 por pagina (?pagina=): lista lateral del cajero.
router.get("/recientes", wrap(async (req, res) => {
  const r = await devolucionService.listarRecientes(req.query);
  res.json({ ok: true, total: r.total, pagina: r.pagina, por_pagina: r.por_pagina, total_paginas: r.total_paginas, data: r.filas });
}));

// Devoluciones reembolsadas por un cajero en un turno (?desde&hasta&cajeros=a,b): las usa el reporte de cierre de caja. Solo lectura.
router.get("/del-turno", wrap(async (req, res) => {
  res.json({ ok: true, data: await devolucionService.listarReembolsadasDelTurno(req.query) });
}));

// TDSI-21/22: valida los productos y cantidades contra la factura, calcula el monto (TOTAL o PARCIAL),
// genera el codigo DEV-0001 y guarda la devolucion en estado PENDIENTE.
router.post("/", wrap(async (req, res) => {
  const data = await devolucionService.registrarDevolucion(req.body);
  res.status(201).json({ ok: true, mensaje: "Devolución registrada", data });
}));

// TDSI-81: exporta a Excel el listado con los mismos filtros (desde, hasta, estado, cajero), sin paginar.
router.get("/exportar", requireAdministrador, wrap(async (req, res) => {
  const { buffer, filas, truncado } = await exportacionService.exportarDevoluciones(req.query);
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="devoluciones-${hoy}.xlsx"`);
  res.setHeader("X-Total-Filas", String(filas));
  if (truncado) res.setHeader("X-Exportacion-Truncada", "true");
  res.send(buffer);
}));

// TDSI-33: bandeja de devoluciones (?estado=PENDIENTE para la bandeja del supervisor) con su contador.
router.get("/", requireAdministradorSalvoBandeja, wrap(async (req, res) => {
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
  // TDSI-117: si es de un pedido del Marketplace, se le avisa el rechazo con su motivo (asincrono; nunca hace fallar el rechazo).
  const marketplace = await marketplaceService.avisarResultadoSeguro(data.codigo);
  res.json({ ok: true, mensaje: "Devolución rechazada", data: { ...data, marketplace: resumenAviso(marketplace) } });
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
router.get("/:codigo/historial", requireAdministrador, wrap(async (req, res) => {
  res.json({ ok: true, data: await devolucionService.obtenerHistorial(req.params.codigo) });
}));

// TDSI-95: reenvia a Contabilidad la nota de credito cuyo envio quedo en Error (solo el administrador).
router.post("/:codigo/contabilidad/reenviar", requireAdministrador, wrap(async (req, res) => {
  const envio = await contabilidadService.reenviarNota(req.params.codigo, { justificacion: req.body?.justificacion });
  const { estado, numero_asiento, motivo } = estadoVisible(envio);
  res.json({ ok: true, mensaje: envio.estado === "Enviado" ? "Nota de crédito reenviada a Contabilidad" : `El reenvío quedó ${estado}`, data: { ...envio, contabilidad: { estado, numero_asiento, motivo } } });
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

// TDSI-108/121: como van los avisos de una devolucion a Compras (Enviado, Recibido, Reclamo registrado N° X o Error) y al
// Marketplace (Enviado o Error), para la seccion del detalle. Solo lectura; null si ese aviso no existe.
router.get("/:codigo/avisos", wrap(async (req, res) => {
  const d = await devolucionService.obtenerDevolucion(req.params.codigo); // 400 / 404
  const compras = await enviosComprasRepo.obtenerPorCodigo(d.codigo);
  const marketplace = d.origen === "MARKETPLACE" ? await enviosMarketplaceRepo.listarPorCodigo(d.codigo) : [];
  const ultimoMarketplace = marketplace[marketplace.length - 1] ?? null;
  res.json({
    ok: true,
    data: {
      codigo: d.codigo,
      compras: compras
        ? { ...enviosComprasRepo.estadoVisible(compras), intentos: compras.intentos, pubsub_message_id: compras.pubsub_message_id, enviado_en: compras.enviado_en, acuse_en: compras.acuse_en, ultimo_error: compras.ultimo_error }
        : null,
      marketplace: ultimoMarketplace
        ? { estado: ultimoMarketplace.estado, resultado: ultimoMarketplace.resultado, intentos: ultimoMarketplace.intentos, pubsub_message_id: ultimoMarketplace.pubsub_message_id, enviado_en: ultimoMarketplace.enviado_en, ultimo_error: ultimoMarketplace.ultimo_error }
        : null,
    },
  });
}));

// TDSI-24: estado, items, motivo y monto de una devolucion por su codigo. Va al final: "motivos" y
// "factura/:numero" son rutas fijas y no deben confundirse con un codigo.
router.get("/:codigo", wrap(async (req, res) => {
  res.json({ ok: true, data: await devolucionService.obtenerDevolucion(req.params.codigo) });
}));

module.exports = router;
