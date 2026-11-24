const turnosRepo = require("../data/turnosRepo");
const metasRepo = require("../data/metasVentaRepo");
const { AppError } = require("../utils/AppError");
const { aCentavos, aMonto } = require("../utils/money");
const { hoyLocal } = require("../utils/fechas");
const { calcularTotalRecaudado, calcularEfectivoEsperado, compararEfectivo, compararArqueo, resumenDigitalYDevoluciones, devolucionesDelTurno } = require("./cierreService");
const { calcularRecaudadoPorCaja } = require("./recaudadoService");
const { limitesDe, colorSegun, INICIALES } = require("./objetivosProxy");

const MENSAJE_SIN_TURNO = "Abra su turno para ver sus indicadores";
const MONTO_MAXIMO = 999999999999.99; // limite de NUMERIC(14,2), igual que el efectivo inicial
// TDSI-219: los consejos del cuadro amarillo "⚠ Avisos" de la pantalla del cajero
const AVISOS = ["Revisa el monto antes de anular una venta.", "Toda devolución necesita el número de factura.", "Cuenta el efectivo dos veces antes de cerrar."];
// El cierre dice SOBRA / FALTA (no SOBRANTE / FALTANTE como el arqueo del administrador)
const ESTADO_CIERRE = { CUADRA: "CUADRA", SOBRANTE: "SOBRA", FALTANTE: "FALTA" };

/** El turno abierto del cajero que inicio sesion (o null). Siempre se busca con SU identidad: nunca con un id que mande el cliente. */
async function turnoDelCajero(cajero, cajaId) {
  return turnosRepo.buscarTurnoAbiertoDeCajero([cajero.email, cajero.cajero_id], cajaId || null);
}

/**
 * "Mi meta de hoy": lo vendido HOY en la caja del turno contra la meta diaria de la caja ("Metas de venta"), su % y su color (VERDE
 * 100 % o mas, AMARILLO 70 - 99 %, ROJO menos de 70 %, con los rangos vigentes del panel). Sin meta cargada: meta, % y color null.
 */
async function metaDeHoy(cajaId) {
  const hoy = hoyLocal();
  const [recaudado, meta, limites] = await Promise.all([
    calcularRecaudadoPorCaja({ caja_id: cajaId, desde: hoy, hasta: hoy }),
    metasRepo.obtenerPorCaja(cajaId),
    limitesDe("cumplimiento_metas", { publico: true }),
  ]);
  const vendido = recaudado.totalRecaudado;
  if (!meta) return { fecha: hoy, vendido, meta: null, porcentaje: null, color: null, umbrales: { verde: limites.verde, amarillo: limites.amarillo } };
  const porcentaje = Math.round((aCentavos(vendido) / aCentavos(meta.monto_meta)) * 10000) / 100;
  return { fecha: hoy, vendido, meta: meta.monto_meta, porcentaje, color: colorSegun(porcentaje, limites), umbrales: { verde: limites.verde, amarillo: limites.amarillo } };
}

/**
 * TDSI-220/221: la pantalla "Mi turno" del cajero que inicio sesion, SOLO con los datos de su turno abierto y de su caja:
 *   numeros: ventas, ticket promedio (Bs vendidos / ventas) y anulaciones del turno
 *   meta_hoy: vendido hoy en la caja, meta, % y color
 *   cierre: efectivo esperado (inicial + ventas en efectivo - salidas por devolucion), que calcula el sistema
 *   avisos: los consejos cortos
 * Sin turno abierto: { turno: null, mensaje: "Abra su turno para ver sus indicadores" } (200: no es un error, es un estado).
 */
async function obtenerMiTurno({ cajero, cajaId } = {}) {
  const turno = await turnoDelCajero(cajero, cajaId);
  if (!turno) return { turno: null, mensaje: MENSAJE_SIN_TURNO, avisos: AVISOS };

  const [recaudado, esperado, meta, devoluciones] = await Promise.all([calcularTotalRecaudado(turno.id), calcularEfectivoEsperado(turno.id), metaDeHoy(turno.caja_id), devolucionesDelTurno(turno)]);
  const { digital, resumenDevoluciones } = resumenDigitalYDevoluciones(recaudado.porMetodo, devoluciones);
  const ventas = recaudado.resumenVentas.cantidadVentas;
  const total = recaudado.totalIngresos;
  return {
    turno: {
      id: Number(turno.id),
      codigo: turno.codigo,
      caja_id: turno.caja_id,
      caja_nombre: turno.caja_nombre || turno.caja_id,
      cajero: cajero.nombre || turno.cajero_nombre || cajero.email,
      abierto_en: turno.abierto_en,
      efectivo_inicial: Number(turno.efectivo_inicial),
    },
    numeros: {
      ventas,
      ticket_promedio: ventas > 0 ? aMonto(Math.round(aCentavos(total) / ventas)) : 0,
      anulaciones: recaudado.resumenVentas.cantidadAnuladas,
      total_vendido: total,
    },
    meta_hoy: meta,
    // lo cobrado en digital (tarjeta + QR) y lo devuelto en el turno: del efectivo, del digital o en vale
    digital,
    devoluciones: resumenDevoluciones,
    cierre: {
      efectivo_esperado: esperado.efectivoEsperado,
      efectivo_inicial: esperado.efectivoInicial,
      ventas_efectivo: esperado.ventasEfectivo,
      egresos_efectivo: esperado.egresosEfectivo,
    },
    avisos: AVISOS,
  };
}

/** El efectivo contado que escribe el cajero: numero >= 0, hasta 2 decimales (texto numerico tambien vale). Devuelve el numero o lanza 400. */
function validarEfectivoContado(valor) {
  if (valor === undefined || valor === null || (typeof valor === "string" && valor.trim() === "") || typeof valor === "boolean") {
    throw new AppError("Ingrese el efectivo contado.", 400, { efectivo_contado: valor ?? null });
  }
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new AppError("El efectivo contado debe ser un número válido.", 400, { efectivo_contado: valor });
  if (n < 0) throw new AppError("El efectivo contado no puede ser negativo.", 400, { efectivo_contado: valor });
  if (n > MONTO_MAXIMO) throw new AppError("El efectivo contado supera el monto máximo permitido.", 400, { efectivo_contado: valor });
  if (Math.round(n * 100) / 100 !== n) throw new AppError("El efectivo contado admite hasta 2 decimales.", 400, { efectivo_contado: valor });
  return n;
}

/**
 * TDSI-222: la fila "Diferencia" del Cierre de turno: con el efectivo contado (o el arqueo por billetes y monedas, que ya existe) calcula
 * la diferencia contra el efectivo esperado del turno y su estado CUADRA, SOBRA o FALTA. NO cierra el turno (eso lo hace "Cerrar turno",
 * con el PIN del supervisor). Reutiliza compararEfectivo / compararArqueo, los mismos del arqueo del cierre.
 */
async function compararCierre({ cajero, cajaId, efectivo_contado: contado, arqueo } = {}) {
  const turno = await turnoDelCajero(cajero, cajaId);
  if (!turno) throw new AppError(MENSAJE_SIN_TURNO, 404);

  const r = arqueo !== undefined && arqueo !== null ? await compararArqueo(turno.id, arqueo) : await compararEfectivo(turno.id, validarEfectivoContado(contado));
  const estado = ESTADO_CIERRE[r.tipoDiferencia];
  return {
    turno_id: Number(turno.id),
    caja_id: turno.caja_id,
    efectivo_esperado: r.efectivoEsperado,
    efectivo_contado: r.efectivoContado,
    diferencia: r.diferencia,
    estado,
    tipo_diferencia: r.tipoDiferencia,
    cuadra: estado === "CUADRA",
    ...(r.denominaciones ? { denominaciones: r.denominaciones } : {}),
  };
}

module.exports = { obtenerMiTurno, compararCierre, validarEfectivoContado, metaDeHoy, MENSAJE_SIN_TURNO, AVISOS, ESTADO_CIERRE, INICIALES };
