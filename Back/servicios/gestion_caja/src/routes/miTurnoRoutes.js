const { Router } = require("express");
const { obtenerMiTurno, compararCierre } = require("../services/miTurnoService");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// TDSI-219/220/221: la pantalla "Mi turno" del cajero (ruta /caja/mi-turno del Frontend). Se monta detras de requireCajero: solo ve el turno
// abierto de SU cuenta (?caja_id= es opcional y solo sirve para acotar a una de SUS cajas).
router.get("/", wrap(async (req, res) => {
  res.json({ ok: true, data: await obtenerMiTurno({ cajero: req.cajero, cajaId: req.query.caja_id }) });
}));

// TDSI-222: la fila "Diferencia" del Cierre de turno: { efectivo_contado } (o { arqueo: [{ denominacion, cantidad }] }) -> diferencia y CUADRA / SOBRA / FALTA.
// No cierra el turno: "Cerrar turno" usa el cierre de siempre con el PIN del supervisor.
router.post("/cierre", wrap(async (req, res) => {
  res.json({ ok: true, data: await compararCierre({ cajero: req.cajero, cajaId: req.query.caja_id ?? req.body?.caja_id, efectivo_contado: req.body?.efectivo_contado, arqueo: req.body?.arqueo }) });
}));

module.exports = router;
