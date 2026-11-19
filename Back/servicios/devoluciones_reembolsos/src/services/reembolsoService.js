const facturacionProxy = require("./facturacionProxy");
const devolucionService = require("./devolucionService");
const { AppError } = require("../utils/AppError");
const { tipoDeReembolso, repartirMonto, redondear } = require("../utils/reembolso");

const bs = (n) => `Bs ${Number(n).toFixed(2)}`;

const TEXTO_POR_TIPO = {
  EFECTIVO: (monto) => `Entregar ${bs(monto)} en efectivo al cliente (sale de la caja del cajero)`,
  REVERSION_TARJETA: (monto) => `Revertir ${bs(monto)} del cobro con tarjeta`,
  REVERSION_QR: (monto) => `Revertir ${bs(monto)} del cobro por QR`,
};

/**
 * TDSI-45: decide COMO se devuelve el dinero de una devolucion: segun el metodo de pago ORIGINAL de la factura
 * se elige EFECTIVO, REVERSION_TARJETA o REVERSION_QR. Si la factura se pago con varios metodos (pago mixto),
 * el monto se reparte en proporcion a lo que se pago con cada uno. Devuelve la lista de reembolsos a hacer:
 *   [{ tipo, metodo, monto, descripcion }]   (la suma de los montos es exactamente el monto de la devolucion)
 *
 * Reglas:
 *   - la factura debe tener su metodo de pago registrado (si no, no se sabe como devolver: 422);
 *   - los pedidos del Marketplace (canal Online) NUNCA se reembolsan con efectivo de caja: 422.
 * Es una funcion pura (no consulta nada): recibe la devolucion y la factura ya leidas.
 */
function planificarReembolso({ monto, factura }) {
  const metodos = factura.metodos_pago ?? [];
  if (metodos.length === 0) {
    throw new AppError(
      `La factura ${factura.numero} no tiene método de pago registrado: no se puede decidir cómo devolver el dinero.`,
      422,
      { factura_numero: factura.numero }
    );
  }
  const desconocido = metodos.find((m) => !tipoDeReembolso(m.metodo));
  if (desconocido) {
    throw new AppError(`El método de pago "${desconocido.metodo}" no tiene un tipo de reembolso.`, 422, { metodo: desconocido.metodo });
  }
  if (factura.canal === "Online" && metodos.some((m) => m.metodo === "Efectivo")) {
    throw new AppError(
      "Los pedidos del Marketplace no se reembolsan con efectivo de caja.",
      422,
      { factura_numero: factura.numero, canal: factura.canal }
    );
  }

  return repartirMonto(monto, metodos)
    .filter((parte) => parte.monto > 0)
    .map((parte) => {
      const tipo = tipoDeReembolso(parte.metodo);
      return { tipo, metodo: parte.metodo, monto: redondear(parte.monto), descripcion: TEXTO_POR_TIPO[tipo](parte.monto) };
    });
}

/**
 * TDSI-45: lo que ve el cajero al abrir "Reembolsar" en una devolucion APROBADA: como se va a devolver el dinero
 * (segun el metodo de pago original y el monto) antes de confirmar. No cambia nada.
 */
async function consultarReembolso(codigo) {
  const devolucion = await devolucionService.obtenerDevolucion(codigo);
  if (devolucion.estado !== "APROBADA") {
    throw new AppError(
      `La devolución ${devolucion.codigo} está ${devolucion.estado}: solo se reembolsan las APROBADAS.`,
      409,
      { codigo: devolucion.codigo, estado: devolucion.estado }
    );
  }
  const factura = await facturacionProxy.obtenerFactura(devolucion.factura_numero);
  const plan = planificarReembolso({ monto: devolucion.monto_total, factura });
  return {
    codigo: devolucion.codigo,
    estado: devolucion.estado,
    monto_total: devolucion.monto_total,
    factura_numero: devolucion.factura_numero,
    canal: factura.canal,
    metodo_pago: factura.metodo_pago,
    plan,
    sale_efectivo_de_caja: plan.some((p) => p.tipo === "EFECTIVO"),
  };
}

module.exports = { planificarReembolso, consultarReembolso };
