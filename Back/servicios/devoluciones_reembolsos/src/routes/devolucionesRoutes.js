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

module.exports = router;
