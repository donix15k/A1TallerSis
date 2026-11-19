const { Router } = require("express");
const devolucionService = require("../services/devolucionService");

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
  const { total, filas } = await devolucionService.listarDevoluciones(req.query);
  res.json({ ok: true, total, data: filas });
}));

// TDSI-35: el supervisor aprueba una devolucion pendiente con su usuario y PIN ({ supervisor_id, pin }).
router.post("/:codigo/aprobar", wrap(async (req, res) => {
  const data = await devolucionService.aprobarDevolucion(req.params.codigo, req.body);
  res.json({ ok: true, mensaje: "Devolución aprobada", data });
}));

// TDSI-24: estado, items, motivo y monto de una devolucion por su codigo. Va al final: "motivos" y
// "factura/:numero" son rutas fijas y no deben confundirse con un codigo.
router.get("/:codigo", wrap(async (req, res) => {
  res.json({ ok: true, data: await devolucionService.obtenerDevolucion(req.params.codigo) });
}));

module.exports = router;
