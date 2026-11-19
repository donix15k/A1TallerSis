const { AppError } = require("../utils/AppError");
const repo = require("../data/pagosRepo");
const { guardarClienteEnFacturacion } = require("./clientesProxy");
const { emitirActualizacion } = require("../utils/tableroEvents");
const { TIPOS_DOCUMENTO_VALIDOS, validarFormatoDocumento } = require("../utils/documento");
const { calcularVuelto, validarMontoRecibido, calcularCobroUsd } = require("./cobroEfectivoService");

const valesProxy = require("./valesProxy");

const METODOS_VALIDOS = ["Efectivo", "Tarjeta", "QR", "Vale"];

/**
 * TDSI-85/262/271/272 + TDSI-289 (via proxy a facturacion)
 * El ID de transaccion ya no viene del cajero: lo genera insertarTransaccionSimple.
 * tipo_documento es opcional: null/ausente = "sin datos de facturacion" (venta
 * sin factura); si se elige NIT o CI, el numero y la razon social son obligatorios.
 */
/**
 * TDSI-423: cajero_id identifica a quien hizo la operacion (para el monitoreo).
 * Si el front todavia no lo manda, se usa "cajero" (hoy es el email del cajero).
 * TDSI-61/199: cajero_nombre es el nombre para mostrar ("Atendido por"), se
 * toma de la cuenta con la que el cajero inicio sesion -- nunca se escribe a mano.
 */
async function registrarPagoSimple({ metodo, monto, tipo_documento, nit, razon_social, telefono, email, caja_id, turno_id, cajero, cajero_id, cajero_nombre, monto_recibido, cobro_duplicado = false, moneda_recibida, monto_usd, codigo_vale }) {
  if (!metodo || monto === undefined) {
    throw new AppError("Los campos metodo y monto son obligatorios.", 400);
  }
  if (!METODOS_VALIDOS.includes(metodo)) {
    throw new AppError(`El metodo "${metodo}" no esta permitido. Use: ${METODOS_VALIDOS.join(", ")}.`, 400);
  }
  if (typeof monto !== "number" || monto <= 0) {
    throw new AppError("El monto debe ser un numero mayor a 0.", 400);
  }

  // TDSI-70: con "Vale" el cajero escribe el codigo; antes de registrar nada se valida con Devoluciones que el vale
  // exista, no este vencido ni usado y que su saldo alcance (si no alcanza, 422 con lo que falta para pago mixto).
  let codigoVale = null;
  if (metodo === "Vale") {
    codigoVale = String(codigo_vale ?? "").trim().toUpperCase();
    await valesProxy.exigirSaldo({ codigo: codigoVale, monto });
  }

  // TDSI-29/550: si pagan en efectivo y mandan cuanto entregó el cliente, se
  // vuelve a validar y calcular el vuelto aquí mismo (nunca se confía en un
  // vuelto que mande el frontend ya calculado) y se guarda junto al cobro.
  //
  // TDSI-813: si pagaron en dólares, el equivalente en Bs y el vuelto se
  // recalculan con calcularCobroUsd (la misma función que usa la vista
  // previa de TDSI-812) usando el tipo de cambio vigente -- nunca se confía
  // en el monto_recibido/tipo_cambio que mande el frontend, igual que con
  // el vuelto normal. Así, lo que queda guardado nunca puede diferir de lo
  // que el cajero vio en pantalla antes de confirmar.
  let vuelto = null;
  let montoRecibidoEfectivo = monto_recibido;
  let monedaRecibida = null;
  let montoUsdGuardado = null;
  let tipoCambioUsado = null;

  if (metodo === "Efectivo" && moneda_recibida === "USD") {
    const cobroUsd = await calcularCobroUsd({ total: monto, dolaresRecibidos: Number(monto_usd) });
    montoRecibidoEfectivo = cobroUsd.equivalenteBs;
    vuelto = cobroUsd.vuelto;
    monedaRecibida = "USD";
    montoUsdGuardado = cobroUsd.dolaresRecibidos;
    tipoCambioUsado = cobroUsd.tipoCambio;
  } else if (metodo === "Efectivo" && montoRecibidoEfectivo !== undefined && montoRecibidoEfectivo !== null) {
    validarMontoRecibido(monto, montoRecibidoEfectivo);
    vuelto = calcularVuelto(monto, montoRecibidoEfectivo);
  }

  const tipoDocumento = tipo_documento || null;
  if (tipoDocumento && !TIPOS_DOCUMENTO_VALIDOS.includes(tipoDocumento)) {
    throw new AppError(`El tipo de documento debe ser NIT, CI, o no indicarse.`, 400);
  }
  if (tipoDocumento) {
    if (!nit || !razon_social) {
      throw new AppError(`Si elige ${tipoDocumento}, el número de documento y la razón social son obligatorios.`, 400);
    }
    const errorFormato = validarFormatoDocumento(tipoDocumento, nit);
    if (errorFormato) {
      throw new AppError(errorFormato, 400, { [tipoDocumento.toLowerCase()]: nit });
    }
  }

  // Solo el NIT alimenta el registro de clientes frecuentes de facturacion:
  // esa tabla es para clientes de negocio (con NIT), no para consumidores con CI.
  const clienteAutoguardado = tipoDocumento === "NIT"
    ? await guardarClienteEnFacturacion({ nit, razon_social, email })
    : { creado: false, cliente: null };

  const pago = await repo.insertarTransaccionSimple({
    metodo,
    monto,
    nit: tipoDocumento ? nit : null,
    razon_social: tipoDocumento ? razon_social : null,
    tipo_documento: tipoDocumento,
    telefono,
    caja_id,
    turno_id,
    cajero,
    cajero_id: cajero_id || cajero,
    cajero_nombre: cajero_nombre || null,
    monto_recibido: metodo === "Efectivo" ? montoRecibidoEfectivo ?? null : null,
    vuelto,
    cobro_duplicado,
    moneda_recibida: monedaRecibida,
    monto_usd: montoUsdGuardado,
    tipo_cambio: tipoCambioUsado,
    codigo_vale: codigoVale,
  });

  // TDSI-70: ya registrada la venta, se descuenta el vale con la transaccion como referencia (idempotente). Si el
  // descuento falla (el saldo cambio justo antes, Devoluciones cae...) la venta se deshace: no queda cobrada sin vale.
  if (codigoVale) {
    try {
      await valesProxy.usarVale({ codigo: codigoVale, monto, referencia: pago.id_transaccion });
    } catch (e) {
      await repo.eliminarVentaRegistrada(pago.id_transaccion);
      throw e;
    }
  }
  const totalTransacciones = await repo.contarTransacciones();
  emitirActualizacion();

  return { pago, totalTransacciones, clienteGuardado: clienteAutoguardado.creado, cliente: clienteAutoguardado.cliente };
}

async function obtenerHistorial() {
  const historial = await repo.listarHistorial();
  return { total: historial.length, historial };
}

/**
 * Autocompletado de razon social: si el NIT/CI ya se uso en un pago anterior
 * (simple o mixto), se devuelve la razon social que se registro esa vez.
 */
async function buscarClientePorDocumento(tipo_documento, numero) {
  if (!TIPOS_DOCUMENTO_VALIDOS.includes(tipo_documento)) {
    throw new AppError("El tipo de documento debe ser NIT o CI.", 400);
  }
  const errorFormato = validarFormatoDocumento(tipo_documento, numero);
  if (errorFormato) {
    throw new AppError(errorFormato, 400);
  }
  const razon_social = await repo.buscarRazonSocialPorDocumento(tipo_documento, String(numero).trim());
  return { razon_social };
}

module.exports = { registrarPagoSimple, obtenerHistorial, buscarClientePorDocumento, METODOS_VALIDOS };