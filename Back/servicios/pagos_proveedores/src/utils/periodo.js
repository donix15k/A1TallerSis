const { AppError } = require("./AppError");
const { hoyLocal } = require("./fecha");

/**
 * TDSI-181: el periodo del Panel de KPIs es un mes "AAAA-MM" (hora de Bolivia). Sin periodo es el mes actual. Devuelve
 * { periodo, desde, hasta } con los dias inclusivos (AAAA-MM-DD). Un periodo mal escrito es 400.
 */
function rangoDelPeriodo(periodo, { hoy = hoyLocal() } = {}) {
  const p = periodo === undefined || periodo === null || periodo === "" ? hoy.slice(0, 7) : String(periodo);
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  const mes = m ? Number(m[2]) : 0;
  if (!m || mes < 1 || mes > 12) {
    throw new AppError("El periodo debe tener el formato AAAA-MM (por ejemplo 2026-11).", 400, { periodo });
  }
  const dias = new Date(Date.UTC(Number(m[1]), mes, 0)).getUTCDate();
  return { periodo: p, desde: `${p}-01`, hasta: `${p}-${String(dias).padStart(2, "0")}` };
}

module.exports = { rangoDelPeriodo };
