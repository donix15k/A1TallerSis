const { AppError } = require("./AppError");

const ZONA = "America/La_Paz";
const hoyBolivia = (ahora = new Date()) => ahora.toLocaleDateString("en-CA", { timeZone: ZONA });

/**
 * El periodo de los KPIs es un mes "AAAA-MM" en hora de Bolivia. Devuelve { periodo, desde, hasta } con el primer y el ultimo dia
 * del mes (AAAA-MM-DD). Sin periodo es el mes actual. 400 si no es un mes real.
 */
function rangoDelPeriodo(periodo, { ahora = new Date() } = {}) {
  const texto = periodo === undefined || periodo === null || String(periodo).trim() === "" ? hoyBolivia(ahora).slice(0, 7) : String(periodo).trim();
  const m = /^([0-9]{4})-([0-9]{2})$/.exec(texto);
  const anio = m ? Number(m[1]) : NaN;
  const mes = m ? Number(m[2]) : NaN;
  if (!m || mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
    throw new AppError("El periodo debe ser un mes con formato AAAA-MM (por ejemplo 2026-11).", 400, { periodo });
  }
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, "0");
  return { periodo: `${anio}-${pad(mes)}`, desde: `${anio}-${pad(mes)}-01`, hasta: `${anio}-${pad(mes)}-${pad(ultimo)}` };
}

module.exports = { rangoDelPeriodo, hoyBolivia, ZONA };
