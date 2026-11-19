const metasMensualesRepo = require("../data/metasMensualesRepo");
const metasRepo = require("../data/metasVentaRepo");
const cajasRepo = require("../data/cajasRepo");
const { calcularRecaudadoPorCaja } = require("./recaudadoService");
const { rangoDelPeriodo } = require("../utils/periodo");

// TDSI-160: KPI 4 · Cumplimiento de metas. VERDE >= 100 %, AMARILLO 70 - 99 %, ROJO < 70 %.
const UMBRALES_METAS = { verde: 100, amarillo: 70 };

const aCentavos = (n) => Math.round(Number(n) * 100);
const aMonto = (c) => c / 100;
const porcentaje = (parte, total) => (total > 0 ? Math.round((parte / total) * 10000) / 100 : 0);

/** TDSI-160: VERDE desde 100 %, AMARILLO desde 70 % (hasta 99,99 %), ROJO por debajo de 70 %. */
function colorCumplimiento(pct) {
  const p = aCentavos(pct);
  if (p >= aCentavos(UMBRALES_METAS.verde)) return "VERDE";
  if (p >= aCentavos(UMBRALES_METAS.amarillo)) return "AMARILLO";
  return "ROJO";
}

/**
 * TDSI-161: la meta del mes de una caja. Primero la meta MENSUAL guardada en "Configurar objetivos" (filas "Meta Caja N");
 * si la caja no la tiene, su meta DIARIA por los dias del mes; sin ninguna, null.
 */
function metaDelMes(mensual, diaria, dias) {
  if (mensual != null) return { monto: aCentavos(mensual), origen: "mensual" };
  if (diaria != null) return { monto: aCentavos(diaria) * dias, origen: "diaria_por_dias" };
  return { monto: null, origen: null };
}

/**
 * TDSI-159: cumplimiento de metas del mes: por cada caja ACTIVA lo vendido, su meta, su % y su color, y el % general = total
 * vendido de las cajas con meta / suma de sus metas x 100. Una caja sin meta se informa (con meta null) pero no entra al general.
 * Sin ninguna meta el general es null (no hay contra que comparar).
 */
async function cumplimientoMetas({ periodo, hoy } = {}) {
  const rango = rangoDelPeriodo(periodo, { hoy });
  const [recaudados, mensuales, diarias, cajas] = await Promise.all([
    calcularRecaudadoPorCaja({ desde: rango.desde, hasta: rango.hasta }),
    metasMensualesRepo.listarTodas(),
    metasRepo.listarTodas(),
    cajasRepo.listarActivas(),
  ]);
  const mensualDe = new Map(mensuales.map((m) => [m.caja_id, m.monto_mensual]));
  const diariaDe = new Map(diarias.map((m) => [m.caja_id, m.monto_meta]));
  const vendidoDe = new Map(recaudados.map((r) => [r.caja_id, r.totalRecaudado]));

  let vendidoConMeta = 0;
  let sumaMetas = 0;
  const lista = cajas.map((caja) => {
    const vendido = aCentavos(vendidoDe.get(caja.codigo) ?? 0);
    const meta = metaDelMes(mensualDe.get(caja.codigo), diariaDe.get(caja.codigo), rango.dias);
    if (meta.monto === null) {
      return { caja_id: caja.codigo, caja_nombre: caja.nombre, vendido: aMonto(vendido), meta: null, porcentaje: null, color: null, meta_origen: null };
    }
    vendidoConMeta += vendido;
    sumaMetas += meta.monto;
    const pct = porcentaje(vendido, meta.monto);
    return { caja_id: caja.codigo, caja_nombre: caja.nombre, vendido: aMonto(vendido), meta: aMonto(meta.monto), porcentaje: pct, color: colorCumplimiento(pct), meta_origen: meta.origen };
  });

  const general = sumaMetas > 0 ? porcentaje(vendidoConMeta, sumaMetas) : null;
  return {
    periodo: rango.periodo,
    desde: rango.desde,
    hasta: rango.hasta,
    general: {
      porcentaje: general,
      color: general === null ? null : colorCumplimiento(general),
      vendido: aMonto(vendidoConMeta),
      meta: aMonto(sumaMetas),
      cajas_con_meta: lista.filter((c) => c.meta !== null).length,
    },
    cajas: lista,
    umbrales: UMBRALES_METAS,
  };
}

module.exports = { cumplimientoMetas, colorCumplimiento, metaDelMes, UMBRALES_METAS };
