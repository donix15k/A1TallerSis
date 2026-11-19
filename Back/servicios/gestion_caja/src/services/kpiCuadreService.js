const cuadreRepo = require("../data/cuadreRepo");
const { rangoDelPeriodo } = require("../utils/periodo");
const { AppError } = require("../utils/AppError");

// TDSI-169: KPI 5 · Efectividad de cuadre. VERDE >= 95 %, AMARILLO 85 - 94 %, ROJO < 85 %.
const UMBRALES_CUADRE = { verde: 95, amarillo: 85 };
const ULTIMOS_POR_DEFECTO = 5;
const ULTIMOS_MAXIMO = 20;

const aCentavos = (n) => Math.round(Number(n) * 100);
const aMonto = (c) => c / 100;
const porcentaje = (parte, total) => (total > 0 ? Math.round((parte / total) * 10000) / 100 : 0);

/** TDSI-169: VERDE desde 95 %, AMARILLO desde 85 % (hasta 94,99 %), ROJO por debajo de 85 %. */
function colorCuadre(pct) {
  const p = aCentavos(pct);
  if (p >= aCentavos(UMBRALES_CUADRE.verde)) return "VERDE";
  if (p >= aCentavos(UMBRALES_CUADRE.amarillo)) return "AMARILLO";
  return "ROJO";
}

/** Forma publica de un turno cerrado: quien lo cerro, en que caja, su diferencia (con signo) y como quedo. */
function aTurno(t) {
  return {
    turno_id: t.id,
    turno: t.codigo,
    caja_id: t.caja_id,
    caja_nombre: t.caja_nombre || t.caja_id,
    cajero: t.cajero_nombre || t.cajero_id,
    diferencia: t.diferencia,
    tipo: t.tipo_diferencia,
    cerrado_en: t.cerrado_en,
  };
}

function validarUltimos(valor) {
  if (valor === undefined || valor === null || valor === "") return ULTIMOS_POR_DEFECTO;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > ULTIMOS_MAXIMO) {
    throw new AppError(`'ultimos' debe ser un entero entre 1 y ${ULTIMOS_MAXIMO}.`, 400, { ultimos: valor });
  }
  return n;
}

/**
 * TDSI-169/170/171: el cuadre de caja del mes.
 *  - turnos_cerrados / turnos_cuadran / porcentaje / color: turnos CERRADOS con arqueo cuyo cierre cae en el periodo (hora de
 *    Bolivia); porcentaje = cuadran / cerrados x 100. Sin turnos cerrados no hay que evaluar: porcentaje y color null (sin_turnos).
 *  - sobrantes / faltantes: suma en Bs (positiva) de lo que sobro y de lo que falto (las devoluciones en efectivo ya vienen
 *    descontadas del efectivo esperado al cerrar, TDSI-44).
 *  - turnos_con_diferencia: los turnos SOBRANTE o FALTANTE, el de mayor diferencia (en valor absoluto) primero.
 *  - ultimos_turnos: los ultimos turnos cerrados del periodo (?ultimos=, 5 por defecto, maximo 20) con su estado.
 */
async function cuadreCaja({ periodo, ultimos, hoy } = {}) {
  const rango = rangoDelPeriodo(periodo, { hoy });
  const cuantos = validarUltimos(ultimos);
  const turnos = await cuadreRepo.turnosCerradosConArqueo(rango.desde, rango.hasta);

  const cuadran = turnos.filter((t) => t.tipo_diferencia === "CUADRA").length;
  const pct = turnos.length ? porcentaje(cuadran, turnos.length) : null;

  let sobrantes = 0;
  let faltantes = 0;
  for (const t of turnos) {
    if (t.tipo_diferencia === "SOBRANTE") sobrantes += Math.abs(aCentavos(t.diferencia));
    if (t.tipo_diferencia === "FALTANTE") faltantes += Math.abs(aCentavos(t.diferencia));
  }

  const conDiferencia = turnos
    .filter((t) => t.tipo_diferencia !== "CUADRA")
    .sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia) || new Date(b.cerrado_en) - new Date(a.cerrado_en));

  return {
    periodo: rango.periodo,
    desde: rango.desde,
    hasta: rango.hasta,
    turnos_cerrados: turnos.length,
    turnos_cuadran: cuadran,
    porcentaje: pct,
    color: pct === null ? null : colorCuadre(pct),
    sin_turnos: turnos.length === 0,
    sobrantes: aMonto(sobrantes),
    faltantes: aMonto(faltantes),
    turnos_con_diferencia: conDiferencia.map(aTurno),
    ultimos_turnos: turnos.slice(0, cuantos).map(aTurno),
    umbrales: UMBRALES_CUADRE,
  };
}

module.exports = { cuadreCaja, colorCuadre, UMBRALES_CUADRE };
