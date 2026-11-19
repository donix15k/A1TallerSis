const { AppError } = require("../utils/AppError");
const turnosRepo = require("../data/turnosRepo");
const movimientosRepo = require("../data/movimientosRepo");

const METODOS_VALIDOS = ["Efectivo", "Tarjeta", "QR", "Mixto"];
const ORIGENES_VALIDOS = ["LOCAL", "PAGOS", "PROVEEDORES", "DEVOLUCIONES"];

/** TDSI-322: bloquea el registro de nuevas ventas si el turno ya esta cerrado. */
async function registrarMovimiento(turnoId, { tipo, metodo, monto, origen_microservicio, referencia_externa, descripcion }) {
  const turno = await turnosRepo.obtenerTurnoPorId(turnoId);
  if (!turno) throw new AppError("Turno no encontrado", 404, { turnoId });

  if (turno.estado === "CERRADO") {
    throw new AppError("El turno esta cerrado: no se pueden registrar nuevas ventas en esta caja", 423, { turnoId });
  }
  if (!["INGRESO", "EGRESO"].includes(tipo)) {
    throw new AppError("El campo 'tipo' debe ser INGRESO o EGRESO", 400);
  }
  if (!METODOS_VALIDOS.includes(metodo)) {
    throw new AppError(`Metodo no valido. Use: ${METODOS_VALIDOS.join(", ")}`, 400);
  }
  if (typeof monto !== "number" || monto <= 0) {
    throw new AppError("El monto debe ser un numero mayor a 0", 400);
  }

  const origen = origen_microservicio || "LOCAL";
  if (!ORIGENES_VALIDOS.includes(origen)) {
    throw new AppError(`Origen no valido. Use: ${ORIGENES_VALIDOS.join(", ")}`, 400, { origen_microservicio });
  }

  // TDSI-46: la salida de efectivo por una devolucion es un EGRESO en efectivo y se identifica por el codigo
  // de la devolucion (DEV-NNNN): una devolucion solo puede sacar efectivo una vez.
  if (origen === "DEVOLUCIONES") {
    if (tipo !== "EGRESO" || metodo !== "Efectivo") {
      throw new AppError("Un movimiento de DEVOLUCIONES debe ser un EGRESO en Efectivo", 400);
    }
    if (typeof referencia_externa !== "string" || !/^DEV-\d{1,10}$/.test(referencia_externa.trim())) {
      throw new AppError("Un movimiento de DEVOLUCIONES necesita como referencia_externa el codigo de la devolucion (DEV-0001)", 400);
    }
  }

  const resultado = await movimientosRepo.insertar({
    caja_id: turno.caja_id,
    turno_id: turnoId,
    tipo,
    metodo,
    monto,
    origen_microservicio: origen,
    referencia_externa: origen === "DEVOLUCIONES" ? referencia_externa.trim() : referencia_externa,
    descripcion,
  });

  if (resultado.duplicado) {
    throw new AppError(
      `La devolucion ${referencia_externa.trim()} ya tiene registrada su salida de efectivo`,
      409,
      { movimiento: resultado.movimiento }
    );
  }
  return resultado;
}

module.exports = { registrarMovimiento };