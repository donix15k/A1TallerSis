const valesRepo = require("../data/valesRepo");
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

module.exports = { consultarVale, normalizarCodigo, estadoVigente, FORMATO_CODIGO };
