const { Router } = require("express");
const ordenesPagoRepo = require("../data/ordenesPagoRepo");
const { consultarOrdenPorNumero } = require("../services/ordenPagoService");
const { registrarEgreso, METODOS_VALIDOS } = require("../services/egresoService");
const { DIAS_PARA_VENCER } = require("../services/kpiDiasPagoService");

// Pantalla "Pagos a proveedores" del administrador (/api/pagos-proveedores, solo administrador). Reusa la logica que ya existia (registrarEgreso:
// valida la orden, el monto adeudado y la liquida); aqui solo se agrega la lista de ordenes y el pago por orden con el administrador como quien paga.
const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// Ordenes de pago que llegaron de Compras: ?estado=PENDIENTE | LIQUIDADA (sin estado, todas; las pendientes primero).
router.get("/ordenes", wrap(async (req, res) => {
  const estado = String(req.query.estado || "").toUpperCase();
  const lista = await ordenesPagoRepo.listarOrdenes({ estado: ["PENDIENTE", "LIQUIDADA"].includes(estado) ? estado : null });
  res.json({
    ok: true,
    dias_para_vencer: DIAS_PARA_VENCER,
    metodos: METODOS_VALIDOS,
    pendientes: lista.filter((o) => o.estado === "PENDIENTE").length,
    data: lista.map((o) => ({ ...o, vencida: o.estado === "PENDIENTE" && o.dias_desde_aprobacion > DIAS_PARA_VENCER })),
  });
}));

// Paga UNA orden: registra el egreso por el monto de la orden (el unico que acepta el sistema) y la deja LIQUIDADA.
router.post("/ordenes/:numero/pagar", wrap(async (req, res) => {
  const orden = await consultarOrdenPorNumero(req.params.numero); // 404 si no existe
  const { metodo, descripcion } = req.body || {};
  const quien = req.administrador?.nombre || req.administrador?.administrador_id || "administrador";
  const r = await registrarEgreso({
    orden_pago_id: orden.id,
    monto: Number(orden.monto),
    metodo,
    descripcion: typeof descripcion === "string" ? descripcion.trim().slice(0, 200) || undefined : undefined,
    registrado_por: String(quien).slice(0, 60),
  });
  res.status(201).json({ ok: true, mensaje: `Orden ${orden.numero} pagada`, data: { orden: r.orden, egreso: r.egreso } });
}));

module.exports = router;
