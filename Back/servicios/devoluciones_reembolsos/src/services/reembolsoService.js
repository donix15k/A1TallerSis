const facturacionProxy = require("./facturacionProxy");
const devolucionService = require("./devolucionService");
const cajaProxy = require("./cajaProxy");
const reversionService = require("./reversionService");
const devolucionesRepo = require("../data/devolucionesRepo");
const reembolsosRepo = require("../data/reembolsosRepo");
const notasCreditoRepo = require("../data/notasCreditoRepo");
const valesRepo = require("../data/valesRepo");
const contabilidadService = require("./contabilidadService");
const { withTransaction, query } = require("../config/db");
const { AppError } = require("../utils/AppError");
const { tipoDeReembolso, repartirMonto, redondear } = require("../utils/reembolso");

const bs = (n) => `Bs ${Number(n).toFixed(2)}`;

const TEXTO_POR_TIPO = {
  EFECTIVO: (monto) => `Entregar ${bs(monto)} en efectivo al cliente (sale de la caja del cajero)`,
  REVERSION_TARJETA: (monto) => `Revertir ${bs(monto)} del cobro con tarjeta`,
  REVERSION_QR: (monto) => `Revertir ${bs(monto)} del cobro por QR`,
  VALE: (monto) => `Entregar un vale de compra por ${bs(monto)} (válido 90 días; no se cambia por dinero)`,
};

const FORMAS = ["ORIGINAL", "VALE"];
/** TDSI-68: "forma" del reembolso: ORIGINAL (segun como pago el cliente, por defecto) o VALE de compra. */
function validarForma(valor) {
  if (valor === undefined || valor === null || valor === "") return "ORIGINAL";
  const forma = String(valor).trim().toUpperCase();
  if (!FORMAS.includes(forma)) throw new AppError(`La forma de reembolso debe ser ${FORMAS.join(" o ")}.`, 400, { forma: valor });
  return forma;
}

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
function planificarReembolso({ monto, factura, forma }) {
  // TDSI-68: si el cliente prefiere un vale de compra, todo el monto va a un vale (no sale efectivo ni se revierte nada).
  if (forma === "VALE") {
    return [{ tipo: "VALE", metodo: "Vale", monto: redondear(monto), descripcion: TEXTO_POR_TIPO.VALE(monto) }];
  }
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
async function consultarReembolso(codigo, { forma = "ORIGINAL" } = {}) {
  forma = validarForma(forma);
  const devolucion = await devolucionService.obtenerDevolucion(codigo);
  if (devolucion.estado === "PROCESADA") {
    // Ya reembolsada: se muestra lo que se hizo (reembolsos guardados y estado de cada reversion).
    const { rows } = await query(`SELECT id FROM devoluciones.devoluciones WHERE codigo = $1`, [devolucion.codigo]);
    return {
      codigo: devolucion.codigo,
      estado: devolucion.estado,
      monto_total: devolucion.monto_total,
      factura_numero: devolucion.factura_numero,
      ya_reembolsada: true,
      reembolsos: await reembolsosRepo.listarPorDevolucion(Number(rows[0].id)),
    };
  }
  if (devolucion.estado !== "APROBADA") {
    throw new AppError(
      `La devolución ${devolucion.codigo} está ${devolucion.estado}: solo se reembolsan las APROBADAS.`,
      409,
      { codigo: devolucion.codigo, estado: devolucion.estado }
    );
  }
  const factura = await facturacionProxy.obtenerFactura(devolucion.factura_numero);
  const plan = planificarReembolso({ monto: devolucion.monto_total, factura, forma });
  return {
    codigo: devolucion.codigo,
    estado: devolucion.estado,
    monto_total: devolucion.monto_total,
    factura_numero: devolucion.factura_numero,
    canal: factura.canal,
    metodo_pago: factura.metodo_pago,
    forma,
    formas_disponibles: FORMAS, // el cajero puede elegir "VALE" si el cliente lo prefiere
    plan,
    sale_efectivo_de_caja: plan.some((p) => p.tipo === "EFECTIVO"),
  };
}

/** Mensaje para el cajero de cada reembolso: lo que debe hacer o lo que ya paso. */
function mensajeDe(r, vale) {
  if (r.tipo === "EFECTIVO") return `Entregue ${bs(r.monto)} al cliente`;
  if (r.tipo === "VALE") return `Vale ${vale.codigo} por ${bs(r.monto)} emitido: válido hasta el ${new Date(vale.expira_en).toLocaleDateString("es-BO", { timeZone: "America/La_Paz" })}`;
  const medio = r.tipo === "REVERSION_QR" ? "QR" : "tarjeta";
  return r.envio?.estado === "ENVIADO"
    ? `Reversión enviada: ${bs(r.monto)} del cobro con ${medio}`
    : `Reversión registrada: ${bs(r.monto)} del cobro con ${medio} se enviará a la pasarela en breve`;
}

/**
 * TDSI-49: reembolsa una devolucion APROBADA y la deja PROCESADA.
 *   cuerpo: { cajero, caja_id }  (caja_id solo hace falta si parte del reembolso sale en efectivo)
 *
 * Todo ocurre en UNA transaccion que bloquea la devolucion:
 *   1. sigue APROBADA (si ya esta PROCESADA -> 409: un reembolso solo se hace una vez; otra -> 409)
 *   2. si hay efectivo: el cajero tiene el turno abierto de esa caja con efectivo suficiente (TDSI-47) y se registra
 *      la salida en Gestion de Caja (TDSI-46, idempotente por codigo)
 *   3. se guardan los reembolsos y los envios a la pasarela (TDSI-48)
 *   4. APROBADA -> PROCESADA con su fila en el historial (quien reembolso)
 * Si algo falla antes del final no queda nada guardado. Una vez guardado se intenta enviar de inmediato las reversiones
 * de tarjeta/QR; si la pasarela falla, quedan pendientes y se reintentan solas.
 * Si fallara la base DESPUES de registrar la salida en Caja, reintentar no saca el efectivo dos veces (idempotente).
 */
async function reembolsar(codigo, cuerpo = {}) {
  const cajero = devolucionService.validarCajero(cuerpo.cajero);
  const cajaId = typeof cuerpo.caja_id === "string" ? cuerpo.caja_id.trim() : "";
  const forma = validarForma(cuerpo.forma);

  const consulta = await consultarReembolso(codigo, { forma }); // 404 / 409 (no aprobada) / 422 (plan imposible)
  if (consulta.ya_reembolsada) {
    throw new AppError(`La devolución ${consulta.codigo} ya fue reembolsada: un reembolso solo se hace una vez.`, 409, { codigo: consulta.codigo, estado: consulta.estado });
  }
  const { plan } = consulta;
  const efectivo = plan.find((p) => p.tipo === "EFECTIVO");
  if (efectivo && !cajaId) throw new AppError("Falta la caja (caja_id) de la que sale el efectivo del reembolso.", 400);

  const guardado = await withTransaction(async (client) => {
    const actual = await devolucionesRepo.bloquearParaReembolso(client, codigo);
    if (!actual) throw new AppError("Devolución no encontrada", 404, { codigo });
    if (actual.estado !== "APROBADA") {
      throw new AppError(
        actual.estado === "PROCESADA"
          ? `La devolución ${actual.codigo} ya fue reembolsada: un reembolso solo se hace una vez.`
          : `La devolución ${actual.codigo} está ${actual.estado}: solo se reembolsan las APROBADAS.`,
        409,
        { codigo: actual.codigo, estado: actual.estado }
      );
    }
    if (efectivo) {
      const { turnoId } = await cajaProxy.validarEfectivoDisponible({ cajaId, cajero, monto: efectivo.monto });
      await cajaProxy.registrarSalidaEfectivo({ turnoId, monto: efectivo.monto, codigo: actual.codigo });
    }
    const reembolsos = await reembolsosRepo.guardarReembolsos(client, actual.id, plan);
    await devolucionesRepo.marcarProcesada(client, actual.id, cajero);
    // TDSI-57: al quedar PROCESADA se emite su nota de credito (misma transaccion: o quedan las dos cosas o ninguna).
    const nota = await notasCreditoRepo.emitirNota(client, actual.id, actual.monto_total);
    // TDSI-68: reembolso en vale de compra: codigo unico VAL-XXXXXX, saldo = monto y vencimiento a 90 dias.
    const parteVale = plan.find((p) => p.tipo === "VALE"); // todo el monto, o solo la parte pagada con vale (pago mixto)
    const vale = parteVale ? await valesRepo.emitirVale(client, actual.id, parteVale.monto) : null;
    return { id: actual.id, reembolsos, nota, vale };
  });

  // Reversiones de tarjeta/QR: primer intento ya (si falla, el proceso periodico las reintenta).
  const pendientes = guardado.reembolsos.filter((r) => r.envio_id).map((r) => r.id);
  if (pendientes.length) await reversionService.procesarPendientes({ reembolsoIds: pendientes }).catch(() => {});

  // TDSI-92: la nota de credito se informa a Contabilidad (asincrono: se publica y no se espera). Nunca hace fallar el
  // reembolso: si Pub/Sub falla, el envio queda para los reintentos.
  const contabilidad = await contabilidadService.enviarNotaSegura(codigo);

  const reembolsos = await reembolsosRepo.listarPorDevolucion(guardado.id);
  const devolucion = await devolucionService.obtenerDevolucion(codigo);
  return {
    codigo: devolucion.codigo,
    estado: devolucion.estado,
    monto_total: devolucion.monto_total,
    reembolsos,
    nota_credito: guardado.nota,
    contabilidad: contabilidad.estado
      ? { estado: contabilidad.estado, intentos: contabilidad.intentos, pubsub_message_id: contabilidad.pubsub_message_id }
      : { estado: null, publicado: false, motivo: contabilidad.motivo || contabilidad.error || null },
    vale: guardado.vale,
    mensajes: reembolsos.map((r) => mensajeDe(r, guardado.vale)),
    historial: devolucion.historial,
  };
}

module.exports = { planificarReembolso, consultarReembolso, reembolsar };
