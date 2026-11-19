const valesRepo = require("../data/valesRepo");
const { withTransaction } = require("../config/db");
const { AppError } = require("../utils/AppError");

const FORMATO_CODIGO = /^VAL-[A-Z0-9]{4,12}$/;
const bs = (n) => `Bs ${Number(n).toFixed(2)}`;

/** El codigo se escribe a mano en caja: se ignoran mayusculas/minusculas y espacios alrededor. */
function normalizarCodigo(codigo) {
  return String(codigo ?? "").trim().toUpperCase();
}

/**
 * Estado real del vale: aunque la tarea diaria todavia no lo haya marcado, un vale ACTIVO cuya fecha de vencimiento
 * ya paso es EXPIRADO. Un vale sin saldo es USADO.
 */
function estadoVigente(vale, ahora = new Date()) {
  if (vale.estado === "USADO" || vale.estado === "EXPIRADO") return vale.estado;
  if (vale.saldo_disponible <= 0) return "USADO";
  if (vale.expira_en && new Date(vale.expira_en) <= ahora) return "EXPIRADO";
  return "ACTIVO";
}

function descripcion(vale, estado) {
  if (estado === "ACTIVO") return `Vale con saldo disponible de ${bs(vale.saldo_disponible)}`;
  if (estado === "USADO") return "El vale no tiene saldo disponible: ya fue usado";
  return "El vale no tiene saldo disponible: está vencido";
}

/**
 * TDSI-69: consulta un vale por su codigo (VAL-XXXXXX): saldo disponible, estado (ACTIVO, USADO, EXPIRADO) y
 * fecha de vencimiento. `utilizable` dice si se puede cobrar con el (solo ACTIVO con saldo). 404 si no existe.
 */
async function consultarVale(codigo) {
  const cod = normalizarCodigo(codigo);
  if (!FORMATO_CODIGO.test(cod)) throw new AppError("El código del vale no es válido (ejemplo: VAL-4F8K2A).", 400, { codigo });
  const vale = await valesRepo.obtenerPorCodigo(cod);
  if (!vale) throw new AppError(`No existe el vale ${cod}.`, 404, { codigo: cod });

  const estado = estadoVigente(vale);
  return {
    codigo: vale.codigo,
    estado,
    monto: vale.monto,
    saldo_disponible: estado === "ACTIVO" ? vale.saldo_disponible : 0,
    saldo_guardado: vale.saldo_disponible,
    emitido_en: vale.emitido_en,
    vence_en: vale.expira_en,
    utilizable: estado === "ACTIVO",
    mensaje: descripcion(vale, estado),
  };
}

function validarMonto(valor) {
  const monto = typeof valor === "string" && valor.trim() !== "" ? Number(valor) : valor;
  if (typeof monto !== "number" || !Number.isFinite(monto) || monto <= 0) throw new AppError("El monto a usar debe ser un número mayor a 0.", 400, { monto: valor });
  if (Math.abs(monto * 100 - Math.round(monto * 100)) > 1e-6) {
    throw new AppError("El monto no puede tener más de 2 decimales.", 400, { monto: valor });
  }
  return Math.round(monto * 100) / 100;
}

function validarReferencia(valor) {
  const ref = typeof valor === "string" ? valor.trim() : "";
  if (!ref) throw new AppError("Falta la referencia del cobro (por ejemplo el id de la transacción).", 400);
  if (ref.length > 60) throw new AppError("La referencia no puede tener más de 60 caracteres.", 400);
  return ref;
}

const resumen = (vale, extra = {}) => ({
  codigo: vale.codigo,
  estado: vale.estado,
  saldo_disponible: vale.saldo_disponible,
  vence_en: vale.expira_en,
  ...extra,
});

/**
 * TDSI-71: cobra `monto` con el vale: descuenta el saldo y, si llega a 0, lo marca USADO.
 *   cuerpo: { monto, referencia }   (referencia = id del cobro; repetirla NO descuenta otra vez: devuelve duplicado)
 * Todo en una transaccion con el vale bloqueado, asi dos cobros a la vez nunca gastan mas que el saldo.
 *   - vale inexistente 404; vencido, usado o sin saldo 409 "El vale no tiene saldo disponible";
 *   - monto mayor al saldo 409 con el saldo disponible (el cajero completa el resto con otro metodo).
 */
async function usarVale(codigo, cuerpo = {}) {
  const cod = normalizarCodigo(codigo);
  if (!FORMATO_CODIGO.test(cod)) throw new AppError("El código del vale no es válido (ejemplo: VAL-4F8K2A).", 400, { codigo });
  const monto = validarMonto(cuerpo.monto);
  const referencia = validarReferencia(cuerpo.referencia);

  return withTransaction(async (client) => {
    const vale = await valesRepo.bloquearPorCodigo(client, cod);
    if (!vale) throw new AppError(`No existe el vale ${cod}.`, 404, { codigo: cod });

    const previo = await valesRepo.usoActivo(client, vale.id, referencia);
    if (previo) return resumen(vale, { monto_usado: previo.monto, duplicado: true });

    const estado = estadoVigente(vale);
    if (estado !== "ACTIVO") throw new AppError("El vale no tiene saldo disponible", 409, { codigo: cod, estado });
    if (Math.round(monto * 100) > Math.round(vale.saldo_disponible * 100)) {
      throw new AppError(`El vale solo tiene ${bs(vale.saldo_disponible)} de saldo disponible.`, 409, { codigo: cod, saldo_disponible: vale.saldo_disponible, monto });
    }
    const actualizado = await valesRepo.descontar(client, vale, monto, referencia);
    return resumen(actualizado, { monto_usado: monto, duplicado: false });
  });
}

/**
 * TDSI-71: deshace un uso (por si el cobro no llego a registrarse): devuelve el saldo y reactiva el vale si habia
 * quedado USADO y no vencio. cuerpo: { referencia }. 404 si ese cobro no uso el vale (o ya se revirtio).
 */
async function revertirUso(codigo, cuerpo = {}) {
  const cod = normalizarCodigo(codigo);
  if (!FORMATO_CODIGO.test(cod)) throw new AppError("El código del vale no es válido (ejemplo: VAL-4F8K2A).", 400, { codigo });
  const referencia = validarReferencia(cuerpo.referencia);

  return withTransaction(async (client) => {
    const vale = await valesRepo.bloquearPorCodigo(client, cod);
    if (!vale) throw new AppError(`No existe el vale ${cod}.`, 404, { codigo: cod });
    const uso = await valesRepo.usoActivo(client, vale.id, referencia);
    if (!uso) throw new AppError(`El cobro ${referencia} no usó el vale ${cod} (o ya se revirtió).`, 404, { codigo: cod, referencia });
    const actualizado = await valesRepo.reintegrar(client, vale, uso);
    return resumen(actualizado, { monto_devuelto: uso.monto });
  });
}

/** TDSI-71: marca EXPIRADO los vales vencidos (la tarea diaria). Devuelve cuantos marco. */
async function expirarVencidos() {
  return valesRepo.marcarExpirados();
}

module.exports = { consultarVale, usarVale, revertirUso, expirarVencidos, normalizarCodigo, estadoVigente, FORMATO_CODIGO };
