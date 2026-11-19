// TDSI-137: calculos del Panel de KPIs del administrador. Las fechas son SIEMPRE hora de Bolivia (America/La_Paz, UTC-4).
// "Venta" = una venta de mostrador (pagos.transacciones; un pago mixto son varias filas con el mismo id_transaccion y cuenta como UNA
// venta). Las ventas anuladas (estado = 'Anulado') nunca cuentan: ni en el total ni en la cantidad.
const { query } = require("../config/db");
const { AppError } = require("../utils/AppError");
const { aCentavos, aMonto } = require("../utils/money");

const ZONA = "America/La_Paz";

// KPI 1 · Ticket promedio: VERDE >= Bs 45, AMARILLO Bs 35 - 44,99, ROJO < Bs 35.
const UMBRALES_TICKET = { verde: 45, amarillo: 35 };

const hoyBolivia = (ahora = new Date()) => ahora.toLocaleDateString("en-CA", { timeZone: ZONA });

/**
 * El periodo es un mes "AAAA-MM". Devuelve { periodo, desde, hasta } con el primer y el ultimo dia del mes (AAAA-MM-DD).
 * Sin periodo es el mes actual en Bolivia. 400 si no es un mes real.
 */
function rangoDelPeriodo(periodo, { ahora = new Date() } = {}) {
  const texto = periodo === undefined || periodo === null || String(periodo).trim() === "" ? hoyBolivia(ahora).slice(0, 7) : String(periodo).trim();
  const m = /^([0-9]{4})-([0-9]{2})$/.exec(texto);
  const anio = m ? Number(m[1]) : NaN;
  const mes = m ? Number(m[2]) : NaN;
  if (!m || mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
    throw new AppError('El periodo debe ser un mes con formato AAAA-MM (por ejemplo 2026-11).', 400, { periodo });
  }
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, "0");
  return { periodo: `${anio}-${pad(mes)}`, desde: `${anio}-${pad(mes)}-01`, hasta: `${anio}-${pad(mes)}-${pad(ultimo)}` };
}

/** Ticket promedio = total vendido / numero de ventas validas, a 2 decimales. Sin ventas es 0 (nunca NaN ni division por cero). */
function calcularTicketPromedio(totalVendido, ventasValidas) {
  const ventas = Number(ventasValidas);
  if (!Number.isFinite(ventas) || ventas <= 0) return 0;
  return aMonto(Math.round(aCentavos(totalVendido) / ventas));
}

/** Semaforo del ticket promedio: VERDE desde Bs 45, AMARILLO de Bs 35 a 44,99 y ROJO por debajo de Bs 35. */
function colorTicketPromedio(valor) {
  const v = aCentavos(valor);
  if (v >= aCentavos(UMBRALES_TICKET.verde)) return "VERDE";
  if (v >= aCentavos(UMBRALES_TICKET.amarillo)) return "AMARILLO";
  return "ROJO";
}

/**
 * Lo vendido entre dos dias (AAAA-MM-DD, inclusivos, hora de Bolivia): { total_vendido, ventas_validas, ventas_anuladas }.
 * Solo cuentan las ventas validas; las anuladas se informan aparte para quien las quiera mostrar.
 */
async function ventasEntre(desde, hasta) {
  const { rows } = await query(
    `SELECT
        COALESCE(SUM(monto) FILTER (WHERE estado <> 'Anulado'), 0)::text            AS total_vendido,
        COUNT(DISTINCT id_transaccion) FILTER (WHERE estado <> 'Anulado')::int      AS ventas_validas,
        COUNT(DISTINCT id_transaccion) FILTER (WHERE estado = 'Anulado')::int       AS ventas_anuladas
       FROM pagos.transacciones
      WHERE (fecha AT TIME ZONE '${ZONA}')::date BETWEEN $1::date AND $2::date`,
    [desde, hasta]
  );
  return { total_vendido: Number(rows[0].total_vendido), ventas_validas: rows[0].ventas_validas, ventas_anuladas: rows[0].ventas_anuladas };
}

/**
 * KPI 1 · Ticket promedio del mes: { periodo, desde, hasta, total_vendido, ventas_validas, ventas_anuladas, valor, color,
 * sin_ventas, umbrales }. Sin ventas el valor es Bs 0,00.
 */
async function ticketPromedio({ periodo, ahora } = {}) {
  const rango = rangoDelPeriodo(periodo, { ahora });
  const v = await ventasEntre(rango.desde, rango.hasta);
  const valor = calcularTicketPromedio(v.total_vendido, v.ventas_validas);
  return { ...rango, ...v, total_vendido: aMonto(aCentavos(v.total_vendido)), valor, color: colorTicketPromedio(valor), sin_ventas: v.ventas_validas === 0, umbrales: UMBRALES_TICKET };
}

module.exports = { rangoDelPeriodo, calcularTicketPromedio, colorTicketPromedio, ventasEntre, ticketPromedio, hoyBolivia, UMBRALES_TICKET, ZONA };
