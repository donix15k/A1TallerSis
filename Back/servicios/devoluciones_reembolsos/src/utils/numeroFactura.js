const { AppError } = require("./AppError");

/**
 * Normaliza el numero de factura que escribe el cajero (por ejemplo " f-000123 " -> "F-000123").
 * No inventa ceros ni prefijos: solo limpia espacios y mayusculas, y rechaza lo que no pueda ser
 * un numero de factura antes de llamar a otro servicio.
 */
function normalizarNumeroFactura(valor) {
  const numero = String(valor ?? "").trim().toUpperCase();
  if (!numero) throw new AppError("Escriba el número de factura.", 400);
  if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(numero)) {
    throw new AppError("El número de factura no es válido. Ejemplo: F-000123.", 400, { numero });
  }
  return numero;
}

module.exports = { normalizarNumeroFactura };
