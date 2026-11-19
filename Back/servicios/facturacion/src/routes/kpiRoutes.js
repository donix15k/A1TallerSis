const { Router } = require("express");
const { aceptacionContable } = require("../services/kpiAceptacionService");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// TDSI-179/180: KPI 6 · aceptacion contable del mes (?periodo=AAAA-MM&limite=50): asientos enviados, registrados y rechazados de
// facturas + notas de credito + diferencias de caja, el % con su color (VERDE >= 98, AMARILLO 95-97,9, ROJO < 95) y la lista de
// rechazados. Se monta detras de requireAdministrador y reenvia el token a Devoluciones y a Gestion de Caja.
router.get("/aceptacion-contable", wrap(async (req, res) => {
  res.json({ ok: true, data: await aceptacionContable({ periodo: req.query.periodo, limite: req.query.limite, token: req.tokenAdministrador }) });
}));

module.exports = router;
