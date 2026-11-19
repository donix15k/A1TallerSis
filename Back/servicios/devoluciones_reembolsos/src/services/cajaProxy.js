// Puente HTTP hacia Gestion de Caja (nunca por SQL cruzado entre servicios).
const { AppError } = require("../utils/AppError");

const urlCaja = () => process.env.GESTION_CAJA_URL || "http://localhost:4004";
const timeoutMs = () => Number(process.env.CAJA_TIMEOUT_MS) || 5000;

/** Llama a Caja con tiempo limite; Caja caida o lenta -> 503. Devuelve { status, cuerpo }. */
async function llamarCaja(ruta, opciones = {}) {
  let respuesta;
  try {
    respuesta = await fetch(`${urlCaja()}${ruta}`, { ...opciones, signal: AbortSignal.timeout(timeoutMs()) });
  } catch (e) {
    const sinRespuesta = e.name === "TimeoutError" || e.name === "AbortError";
    throw new AppError(
      sinRespuesta ? "Gestión de Caja no respondió a tiempo. Intente de nuevo." : "No se pudo conectar con Gestión de Caja. Intente de nuevo.",
      503,
      { causa: e.message }
    );
  }
  return { status: respuesta.status, cuerpo: await respuesta.json().catch(() => null) };
}

/**
 * TDSI-46: registra en el turno abierto del cajero la SALIDA de efectivo de un reembolso, llamando a
 * POST {GESTION_CAJA_URL}/api/caja/turnos/:id/movimientos con concepto "Devolución DEV-XXXX".
 * (En Caja la salida se guarda como tipo EGRESO en Efectivo con origen DEVOLUCIONES; la referencia es el codigo.)
 *
 * Es IDEMPOTENTE: una devolucion solo puede sacar efectivo una vez. Si Caja ya tenia registrada esa salida
 * (409), no es un error: devuelve el movimiento que ya existia con { duplicado: true }. Asi, si algo falla
 * DESPUES de registrar la salida, reintentar el reembolso nunca saca el efectivo dos veces.
 *   - turno inexistente (404) / turno cerrado (423) / datos invalidos (400) -> se propaga el error con el mismo estado
 *   - Caja caida o lenta -> 503
 * Devuelve { movimiento, duplicado }.
 */
async function registrarSalidaEfectivo({ turnoId, monto, codigo }) {
  const { status, cuerpo } = await llamarCaja(`/api/caja/turnos/${encodeURIComponent(turnoId)}/movimientos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tipo: "EGRESO",
      metodo: "Efectivo",
      monto,
      origen_microservicio: "DEVOLUCIONES",
      referencia_externa: codigo,
      descripcion: `Devolución ${codigo}`,
    }),
  });

  if (status === 201 && cuerpo?.data) return { movimiento: cuerpo.data, duplicado: false };
  if (status === 409 && cuerpo?.detalle?.movimiento) return { movimiento: cuerpo.detalle.movimiento, duplicado: true };
  if ([400, 404, 423].includes(status)) {
    throw new AppError(cuerpo?.mensaje || "Gestión de Caja rechazó la salida de efectivo.", status, cuerpo?.detalle ?? null);
  }
  throw new AppError("Gestión de Caja devolvió una respuesta inesperada al registrar la salida de efectivo.", 502, { status });
}

/** Propaga un rechazo de Caja con su mismo estado, o 502 si no es uno de los esperados. */
function errorDeCaja(status, cuerpo, mensajeInesperado) {
  if ([400, 404, 423].includes(status)) return new AppError(cuerpo?.mensaje || mensajeInesperado, status, cuerpo?.detalle ?? null);
  return new AppError(mensajeInesperado, 502, { status });
}

const bs = (n) => `Bs ${Number(n).toFixed(2)}`;

/**
 * TDSI-47: valida que el reembolso en efectivo se pueda entregar desde la caja de este cajero:
 *   1. la caja tiene un turno ABIERTO (si no, 422)
 *   2. ese turno es del cajero que reembolsa (si no, 403: no se saca efectivo de la caja de otro)
 *   3. el efectivo esperado del turno (inicial + ventas en efectivo - salidas) alcanza para el monto (si no, 422)
 * Devuelve { turnoId, efectivoEsperado }. Caja caida o lenta -> 503.
 */
async function validarEfectivoDisponible({ cajaId, cajero, monto }) {
  const actual = await llamarCaja(`/api/caja/turnos/actual?caja_id=${encodeURIComponent(cajaId)}`);
  if (actual.status === 404) {
    throw new AppError(`La caja "${cajaId}" no tiene un turno abierto: abra turno para entregar efectivo.`, 422, { caja_id: cajaId });
  }
  if (actual.status !== 200 || !actual.cuerpo?.data) throw errorDeCaja(actual.status, actual.cuerpo, "Gestión de Caja devolvió una respuesta inesperada al buscar el turno abierto.");
  const turno = actual.cuerpo.data;

  if (String(turno.cajero_id).toLowerCase() !== String(cajero).toLowerCase()) {
    throw new AppError(`El turno abierto de la caja "${cajaId}" es de otro cajero: solo ese cajero puede entregar efectivo de esa caja.`, 403, { caja_id: cajaId });
  }

  const e = await llamarCaja(`/api/caja/turnos/${encodeURIComponent(turno.id)}/efectivo-esperado`);
  if (e.status !== 200 || !e.cuerpo?.data) throw errorDeCaja(e.status, e.cuerpo, "Gestión de Caja devolvió una respuesta inesperada al consultar el efectivo esperado.");
  const esperado = Number(e.cuerpo.data.efectivoEsperado);

  if (Math.round(esperado * 100) < Math.round(monto * 100)) {
    throw new AppError(`Efectivo insuficiente en caja: hay ${bs(esperado)} y el reembolso es de ${bs(monto)}.`, 422, { efectivo_esperado: esperado, monto });
  }
  return { turnoId: Number(turno.id), efectivoEsperado: esperado };
}

module.exports = { registrarSalidaEfectivo, validarEfectivoDisponible, llamarCaja };
