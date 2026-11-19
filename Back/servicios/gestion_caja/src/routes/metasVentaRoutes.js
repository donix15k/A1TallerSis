const { Router } = require("express");
const { actualizarMeta, obtenerAvancePorCaja, resumenMetas } = require("../services/metasVentaService");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// TDSI-58/774: "Metas de venta" -- meta, vendido y % de avance por caja (?fecha=, por defecto hoy).
router.get("/", wrap(async (req, res) => {
  const data = await obtenerAvancePorCaja(req.query.fecha);
  res.json({ ok: true, data });
}));

// TDSI-139: la meta diaria total (suma de las cajas activas con meta), para la linea del grafico "Ventas diarias vs meta".
router.get("/resumen", wrap(async (req, res) => {
  res.json({ ok: true, data: await resumenMetas() });
}));

// TDSI-58/773: "Editar meta" -- fija la meta diaria (en Bs) de una caja.
router.put("/:cajaId", wrap(async (req, res) => {
  const meta = await actualizarMeta(req.params.cajaId, req.body);
  res.json({ ok: true, mensaje: "Meta actualizada", data: meta });
}));

module.exports = router;
