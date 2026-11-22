const { Router } = require("express");
const valeService = require("../services/valeService");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// Cupones generados: cada vale con su cliente, fecha y hora de emision, monto y estado (?q=&pagina=&por_pagina=).
router.get("/", wrap(async (req, res) => {
  const r = await valeService.listarCupones(req.query);
  res.json({ ok: true, total: r.total, pagina: r.pagina, por_pagina: r.por_pagina, total_paginas: r.total_paginas, data: r.filas });
}));

// TDSI-69: saldo disponible, estado (ACTIVO, USADO, EXPIRADO) y fecha de vencimiento de un vale.
router.get("/:codigo", wrap(async (req, res) => {
  res.json({ ok: true, data: await valeService.consultarVale(req.params.codigo) });
}));

// TDSI-71: cobra con el vale: descuenta el saldo y lo marca USADO al llegar a 0. Body: { monto, referencia }.
router.post("/:codigo/usar", wrap(async (req, res) => {
  const data = await valeService.usarVale(req.params.codigo, req.body);
  res.json({ ok: true, mensaje: data.duplicado ? "Ese cobro ya había usado el vale" : `Se descontaron Bs ${data.monto_usado.toFixed(2)} del vale`, data });
}));

// TDSI-71: deshace un uso (si el cobro no llego a registrarse). Body: { referencia }.
router.post("/:codigo/revertir-uso", wrap(async (req, res) => {
  res.json({ ok: true, mensaje: "Uso del vale revertido", data: await valeService.revertirUso(req.params.codigo, req.body) });
}));

module.exports = router;
