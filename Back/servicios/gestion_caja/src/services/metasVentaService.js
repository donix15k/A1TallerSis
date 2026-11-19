const { AppError } = require("../utils/AppError");
const metasRepo = require("../data/metasVentaRepo");
const cajasRepo = require("../data/cajasRepo");
const { calcularRecaudadoPorCaja } = require("./recaudadoService");

/** Forma publica de una meta (monto en Bs, quien la cambio y cuando). */
function aPublico(meta) {
  return {
    caja_id: meta.caja_id,
    monto_meta: meta.monto_meta,
    actualizado_por: meta.actualizado_por,
    actualizado_en: meta.actualizado_en,
  };
}

/**
 * TDSI-58/773: "Editar meta" -- fija (o cambia) la meta de ventas diaria de una caja.
 * Exige que la meta sea mayor a 0 y que la caja exista.
 */
async function actualizarMeta(cajaId, { monto, actualizado_por } = {}) {
  if (!cajaId || !String(cajaId).trim()) {
    throw new AppError("Falta el id de la caja.", 400);
  }
  const montoMeta = Number(monto);
  if (!Number.isFinite(montoMeta) || montoMeta <= 0) {
    throw new AppError("La meta debe ser un monto mayor a 0.", 400, { monto });
  }

  const caja = await cajasRepo.buscarPorCodigo(cajaId);
  if (!caja) throw new AppError(`La caja "${cajaId}" no existe`, 404, { caja_id: cajaId });

  const meta = await metasRepo.guardarMeta(cajaId, { montoMeta, actualizadoPor: actualizado_por });
  return aPublico(meta);
}

const SIN_META = "sin meta";

/**
 * TDSI-58/775/776: % de avance de lo vendido contra la meta, redondeado a 2 decimales.
 * "sin meta" si la caja todavia no tiene una meta cargada (montoMeta null/undefined) --
 * no hay avance que calcular sin una meta. Puede superar 100 (meta ya cumplida).
 */
function calcularPorcentajeAvance(vendido, montoMeta) {
  if (montoMeta == null) return SIN_META;
  return Number(((vendido / montoMeta) * 100).toFixed(2));
}

/**
 * TDSI-58/774/775: meta, vendido y % de avance por caja, para el dia pedido (por
 * defecto hoy -- reutiliza el default de recaudadoService.calcularRecaudadoPorCaja, no
 * lo reimplementa). Una caja sin meta cargada devuelve "sin meta" en vez de un numero,
 * tanto en "meta" como en "porcentaje" (no hay avance que calcular sin una meta).
 */
async function obtenerAvancePorCaja(fecha) {
  const [recaudados, metas] = await Promise.all([
    calcularRecaudadoPorCaja({ desde: fecha, hasta: fecha }),
    metasRepo.listarTodas(),
  ]);
  const metaPorCaja = new Map(metas.map((m) => [m.caja_id, m.monto_meta]));

  return recaudados.map((r) => {
    const montoMeta = metaPorCaja.get(r.caja_id);
    const vendido = r.totalRecaudado;
    return {
      caja_id: r.caja_id,
      caja_nombre: r.caja_nombre,
      fecha: r.desde,
      vendido,
      meta: montoMeta ?? SIN_META,
      porcentaje: calcularPorcentajeAvance(vendido, montoMeta),
    };
  });
}

/**
 * TDSI-139: la meta diaria de TODAS las cajas activas sumada (la linea roja del grafico "Ventas diarias vs meta" del Panel de KPIs).
 * Solo cuentan las cajas activas que ya tienen meta; "meta_diaria_total" es null si ninguna la tiene (sin meta no hay linea).
 */
async function resumenMetas() {
  const [metas, cajas] = await Promise.all([metasRepo.listarTodas(), cajasRepo.listarActivas()]);
  const activas = new Set(cajas.map((c) => c.codigo));
  const conMeta = metas.filter((m) => activas.has(m.caja_id));
  const totalCentavos = conMeta.reduce((a, m) => a + Math.round(Number(m.monto_meta) * 100), 0);
  return {
    meta_diaria_total: conMeta.length ? totalCentavos / 100 : null,
    cajas_activas: cajas.length,
    cajas_con_meta: conMeta.length,
    cajas: conMeta.map((m) => ({ caja_id: m.caja_id, monto_meta: Number(m.monto_meta) })),
  };
}

module.exports = { resumenMetas, actualizarMeta, obtenerAvancePorCaja, calcularPorcentajeAvance, aPublico };
