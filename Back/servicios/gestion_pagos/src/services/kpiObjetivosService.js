const { query } = require("../config/db");

// TDSI-190/191: los objetivos del semaforo del Panel de KPIs (pagos.kpi_objetivos). Cada indicador tiene tres limites y un sentido:
//   MAYOR (mas es mejor):  VERDE si valor >= verde;  AMARILLO si valor >= amarillo;  si no, ROJO.
//   MENOR (menos es mejor): VERDE si valor <= verde; AMARILLO si valor <= amarillo;  si no, ROJO.
// "rojo" es el extremo de la zona roja (tope de la barra semaforo). Los rangos iniciales son los del PDF; si la tabla no responde o falta
// una fila, se usan estos mismos (el panel nunca se queda sin color por un problema de configuracion).
const INDICADORES = [
  { indicador: "ticket_promedio", nombre: "Ticket promedio", unidad: "Bs", verde: 45, amarillo: 35, rojo: 0, sentido: "MAYOR" },
  { indicador: "tasa_anulacion", nombre: "Tasa de anulación", unidad: "%", verde: 2, amarillo: 5, rojo: 10, sentido: "MENOR" },
  { indicador: "tasa_devoluciones", nombre: "Tasa de devoluciones", unidad: "%", verde: 1.5, amarillo: 3, rojo: 6, sentido: "MENOR" },
  { indicador: "cumplimiento_metas", nombre: "Cumplimiento de metas", unidad: "%", verde: 100, amarillo: 70, rojo: 0, sentido: "MAYOR" },
  { indicador: "efectividad_cuadre", nombre: "Efectividad de cuadre", unidad: "%", verde: 95, amarillo: 85, rojo: 0, sentido: "MAYOR" },
  { indicador: "aceptacion_contable", nombre: "Aceptación contable", unidad: "%", verde: 98, amarillo: 95, rojo: 0, sentido: "MAYOR" },
  { indicador: "dias_pago_proveedores", nombre: "Días de pago a proveedores", unidad: "días", verde: 7, amarillo: 15, rojo: 30, sentido: "MENOR" },
];
const POR_DEFECTO = Object.fromEntries(INDICADORES.map((i) => [i.indicador, i]));

const aCentavos = (n) => Math.round(Number(n) * 100);

/**
 * TDSI-191: el color (VERDE, AMARILLO o ROJO) de un valor segun sus limites. null o NaN no tienen color (un indicador sin datos se
 * muestra sin color). Se compara en centavos para que 2,00 y 2.0000001 no cambien de color por el redondeo.
 */
function colorSegun(valor, limites) {
  if (valor === null || valor === undefined || valor === "" || !Number.isFinite(Number(valor))) return null;
  const v = aCentavos(valor);
  if (limites.sentido === "MENOR") {
    if (v <= aCentavos(limites.verde)) return "VERDE";
    if (v <= aCentavos(limites.amarillo)) return "AMARILLO";
    return "ROJO";
  }
  if (v >= aCentavos(limites.verde)) return "VERDE";
  if (v >= aCentavos(limites.amarillo)) return "AMARILLO";
  return "ROJO";
}

/** Los limites de un indicador que no esta guardado: los iniciales del PDF. */
function limitesPorDefecto(indicador) {
  const i = POR_DEFECTO[indicador];
  return i ? { ...i } : null;
}

const aObjetivo = (r) => ({
  indicador: r.indicador,
  nombre: r.nombre,
  unidad: r.unidad,
  verde: Number(r.limite_verde),
  amarillo: Number(r.limite_amarillo),
  rojo: Number(r.limite_rojo),
  sentido: r.sentido,
  actualizado_por: r.actualizado_por ?? null,
  actualizado_en: r.actualizado_en ?? null,
});

/**
 * TDSI-190: los objetivos de los 7 indicadores (en orden), de la tabla; una fila que falta se completa con los rangos iniciales.
 * Si la tabla no se puede leer devuelve los iniciales (nunca tumba al Panel).
 */
async function listarObjetivos() {
  let guardados = new Map();
  try {
    const { rows } = await query(`SELECT * FROM pagos.kpi_objetivos`);
    guardados = new Map(rows.map((r) => [r.indicador, aObjetivo(r)]));
  } catch (e) {
    console.error("[kpi] No se pudieron leer los objetivos, se usan los iniciales:", e.message);
  }
  return INDICADORES.map((i) => guardados.get(i.indicador) || { ...i, actualizado_por: null, actualizado_en: null });
}

/** Los limites vigentes de un indicador: { indicador, verde, amarillo, rojo, sentido, ... }. */
async function limitesDe(indicador) {
  return (await listarObjetivos()).find((o) => o.indicador === indicador) || limitesPorDefecto(indicador);
}

/** El color de un valor segun los objetivos VIGENTES de su indicador. */
async function colorDe(indicador, valor) {
  return colorSegun(valor, await limitesDe(indicador));
}

module.exports = { INDICADORES, colorSegun, limitesPorDefecto, listarObjetivos, limitesDe, colorDe };
