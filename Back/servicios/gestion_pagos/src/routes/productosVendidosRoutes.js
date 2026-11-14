const { Router } = require("express");
const { obtenerConEstadoEnvio, enviarACompras } = require("../services/productosVendidosService");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// TDSI-54/702: pantalla "Productos Vendidos" -- productos del dia + estado del envio a Compras.
router.get("/productos-vendidos", wrap(async (req, res) => {
  const data = await obtenerConEstadoEnvio(req.query.fecha);
  res.json({ ok: true, data });
}));

// TDSI-54/702/964: boton "Enviar a Compras". grupo_origen (opcional) simula -- solo para
// pruebas, igual que en "Verificación de Pub/Sub" -- que el envio viene de otro grupo;
// el destino siempre es Compras.
router.post("/productos-vendidos/:fecha/enviar-compras", wrap(async (req, res) => {
  const cuerpo = req.body || {};
  const data = await enviarACompras(req.params.fecha, {
    grupoOrigen: cuerpo.grupo_origen,
    enviadoPor: cuerpo.enviado_por,
  });
  res.json({ ok: true, mensaje: "Reporte enviado a Compras", data });
}));

module.exports = router;
