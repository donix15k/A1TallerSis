// Puente HTTP hacia el microservicio de Devoluciones, donde viven los vales de compra (nunca SQL cruzado).
const { AppError } = require("../utils/AppError");

const urlDevoluciones = () => process.env.DEVOLUCIONES_URL || "http://localhost:4007";
const timeoutMs = () => Number(process.env.VALES_TIMEOUT_MS) || 5000;
const bs = (n) => `Bs ${Number(n).toFixed(2)}`;

async function llamar(ruta, opciones = {}) {
  let respuesta;
  try {
    respuesta = await fetch(`${urlDevoluciones()}${ruta}`, { ...opciones, signal: AbortSignal.timeout(timeoutMs()) });
  } catch (e) {
    const sinRespuesta = e.name === "TimeoutError" || e.name === "AbortError";
    throw new AppError(
      sinRespuesta ? "Devoluciones no respondió a tiempo: no se pudo validar el vale. Intente de nuevo." : "No se pudo conectar con Devoluciones para validar el vale. Intente de nuevo.",
      503,
      { causa: e.message }
    );
  }
  return { status: respuesta.status, cuerpo: await respuesta.json().catch(() => null) };
}

const post = (ruta, cuerpo) => llamar(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });

function errorDe(status, cuerpo, mensajeInesperado) {
  if ([400, 404, 409].includes(status)) return new AppError(cuerpo?.mensaje || mensajeInesperado, status, cuerpo?.detalle ?? null);
  return new AppError(mensajeInesperado, 502, { status });
}

/** Consulta el vale: { codigo, estado, saldo_disponible, vence_en, utilizable, ... }. 404 si no existe. */
async function consultarVale(codigo) {
  const { status, cuerpo } = await llamar(`/api/vales/${encodeURIComponent(String(codigo ?? "").trim())}`);
  if (status === 200 && cuerpo?.data) return cuerpo.data;
  throw errorDe(status, cuerpo, "Devoluciones devolvió una respuesta inesperada al consultar el vale.");
}

/**
 * TDSI-70: valida que el vale se pueda cobrar por `monto` ANTES de registrar la venta:
 *   - no existe -> 404; vencido, usado o sin saldo -> 409 "El vale no tiene saldo disponible"
 *   - el saldo no alcanza -> 422 con lo que falta, para completar con otro metodo (pago mixto)
 * Devuelve el vale consultado.
 */
async function exigirSaldo({ codigo, monto }) {
  if (!codigo || !String(codigo).trim()) throw new AppError("Falta el código del vale.", 400);
  const vale = await consultarVale(codigo);
  if (!vale.utilizable) throw new AppError("El vale no tiene saldo disponible", 409, { codigo: vale.codigo, estado: vale.estado });
  if (Math.round(vale.saldo_disponible * 100) < Math.round(monto * 100)) {
    const faltante = Math.round(monto * 100 - vale.saldo_disponible * 100) / 100;
    throw new AppError(
      `El vale solo tiene ${bs(vale.saldo_disponible)}: complete los ${bs(faltante)} restantes con otro método (pago mixto).`,
      422,
      { codigo: vale.codigo, saldo_disponible: vale.saldo_disponible, monto, faltante, sugerencia: "PAGO_MIXTO" }
    );
  }
  return vale;
}

/** Descuenta `monto` del vale para este cobro (referencia = id de la transaccion; repetirla no descuenta dos veces). */
async function usarVale({ codigo, monto, referencia }) {
  const { status, cuerpo } = await post(`/api/vales/${encodeURIComponent(String(codigo).trim())}/usar`, { monto, referencia });
  if (status === 200 && cuerpo?.data) return cuerpo.data;
  throw errorDe(status, cuerpo, "Devoluciones devolvió una respuesta inesperada al usar el vale.");
}

/** Deshace el uso de un vale (si la venta no llego a registrarse). Es de mejor esfuerzo: no lanza. */
async function revertirUso({ codigo, referencia }) {
  try {
    await post(`/api/vales/${encodeURIComponent(String(codigo).trim())}/revertir-uso`, { referencia });
  } catch (e) {
    console.error(`No se pudo revertir el uso del vale ${codigo} (${referencia}):`, e.message);
  }
}

module.exports = { consultarVale, exigirSaldo, usarVale, revertirUso };
