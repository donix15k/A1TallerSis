// TDSI-209: formato comun del reporte de KPIs (PDF y Excel): numeros a la boliviana y el texto de cada valor segun su unidad.
const { numero } = require("./kpiAlertasService");

const COLORES = { VERDE: "#16A34A", AMARILLO: "#EAB308", ROJO: "#DC2626" };
const COLORES_CLAROS = { VERDE: "FFD1FAE5", AMARILLO: "FFFEF3C7", ROJO: "FFFEE2E2" }; // relleno de celda en Excel (ARGB)

/** 2,5 -> "2,5"; 2,89 -> "2,89"; 100 -> "100": hasta 2 decimales, sin ceros de sobra (como los muestra el panel). */
function numeroCorto(n) {
  const completo = numero(n, 2);
  return completo.replace(/,00$/, "").replace(/(,\d)0$/, "$1");
}

/** Un monto en Bs con su signo delante: Bs 22,00 · -Bs 22,00. */
function montoBs(n) {
  return `${Number(n) < 0 ? "-" : ""}Bs ${numero(Math.abs(Number(n)), 2)}`;
}

/** El valor de un KPI con su unidad: Bs 40,00 · 2,89 % · 5,8 días; sin dato es "Sin datos". */
function textoValor(valor, unidad) {
  if (valor === null || valor === undefined) return "Sin datos";
  if (unidad === "Bs") return montoBs(valor);
  if (unidad === "%") return `${numeroCorto(valor)} %`;
  if (unidad === "días") return `${numero(valor, 1)} días`;
  return numeroCorto(valor);
}

const bs = (n) => (n === null || n === undefined ? "" : montoBs(n));
const fechaHora = (iso) => new Date(iso).toLocaleString("es-BO", { timeZone: "America/La_Paz", dateStyle: "short", timeStyle: "short" });
const estadoTexto = (color) => color || "Sin datos";

module.exports = { COLORES, COLORES_CLAROS, numeroCorto, textoValor, bs, fechaHora, estadoTexto };
