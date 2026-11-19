// TDSI-137: calculos del Panel de KPIs del administrador. Las fechas son SIEMPRE hora de Bolivia (America/La_Paz, UTC-4).
// "Venta" = una venta de mostrador (pagos.transacciones; un pago mixto son varias filas con el mismo id_transaccion y cuenta como UNA
// venta). Las ventas anuladas (estado = 'Anulado') nunca cuentan: ni en el total ni en la cantidad.
const { query } = require("../config/db");
const { AppError } = require("../utils/AppError");
const { aCentavos, aMonto } = require("../utils/money");
const { obtenerMetaDiaria } = require("./metasProxy");

const ZONA = "America/La_Paz";

// KPI 1 · Ticket promedio: VERDE >= Bs 45, AMARILLO Bs 35 - 44,99, ROJO < Bs 35.
const UMBRALES_TICKET = { verde: 45, amarillo: 35 };

// KPI 2 · Tasa de anulacion: VERDE <= 2 %, AMARILLO 2 - 5 %, ROJO > 5 %.
const UMBRALES_ANULACION = { verde: 2, amarillo: 5 };

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

/** Un porcentaje a 2 decimales: parte / total x 100. Sin total es 0 % (nunca NaN ni division por cero). */
function calcularPorcentaje(parte, total) {
  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.round((Number(parte) / t) * 10000) / 100;
}

/** Semaforo de la tasa de anulacion: VERDE hasta 2 %, AMARILLO por encima de 2 % y hasta 5 %, ROJO por encima de 5 %. */
function colorTasaAnulacion(tasa) {
  const t = aCentavos(tasa);
  if (t <= aCentavos(UMBRALES_ANULACION.verde)) return "VERDE";
  if (t <= aCentavos(UMBRALES_ANULACION.amarillo)) return "AMARILLO";
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

/**
 * TDSI-138: el resumen del Panel de KPIs de un mes. "tarjetas" es la fila de tarjetas de la pestaña Resumen, en su orden; cada
 * KPI nuevo (anulacion, devoluciones, metas, cuadre...) agrega la suya. Hoy: Ticket promedio (valor, color del semaforo y detalle).
 */
async function resumen({ periodo, ahora } = {}) {
  const ticket = await ticketPromedio({ periodo, ahora });
  return {
    periodo: ticket.periodo,
    desde: ticket.desde,
    hasta: ticket.hasta,
    tarjetas: [
      {
        id: "ticket_promedio",
        nombre: "Ticket promedio",
        valor: ticket.valor,
        unidad: "Bs",
        color: ticket.color,
        detalle: { total_vendido: ticket.total_vendido, ventas_validas: ticket.ventas_validas, ventas_anuladas: ticket.ventas_anuladas, sin_ventas: ticket.sin_ventas, umbrales: ticket.umbrales },
      },
    ],
  };
}

/**
 * TDSI-148: KPI 2 · Tasa de anulacion del mes = facturas anuladas / facturas emitidas x 100 (una venta de mostrador es una factura;
 * "emitidas" son las validas MAS las anuladas). Ejemplo: 31 de 1.073 facturas = 2,89 % (AMARILLO). Sin facturas: 0 %.
 */
async function tasaAnulacion({ periodo, ahora } = {}) {
  const rango = rangoDelPeriodo(periodo, { ahora });
  const v = await ventasEntre(rango.desde, rango.hasta);
  const emitidas = v.ventas_validas + v.ventas_anuladas;
  const valor = calcularPorcentaje(v.ventas_anuladas, emitidas);
  return { ...rango, anuladas: v.ventas_anuladas, emitidas, valor, color: colorTasaAnulacion(valor), sin_facturas: emitidas === 0, umbrales: UMBRALES_ANULACION };
}

const DIAS_GRAFICO = 30;

/** Suma/resta dias a un AAAA-MM-DD (calendario puro, sin zona horaria). */
function sumarDias(dia, n) {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Los 30 dias del grafico: terminan el ultimo dia del periodo, o HOY (Bolivia) si el periodo es el mes en curso (no se grafican
 * dias que todavia no pasaron). Pueden empezar en el mes anterior.
 */
function ventanaDelGrafico(periodo, { ahora = new Date() } = {}) {
  const rango = rangoDelPeriodo(periodo, { ahora });
  const hoy = hoyBolivia(ahora);
  const fin = hoy < rango.hasta ? (hoy >= rango.desde ? hoy : rango.hasta) : rango.hasta;
  return { ...rango, serie_desde: sumarDias(fin, -(DIAS_GRAFICO - 1)), serie_hasta: fin };
}

/**
 * TDSI-139: "Ventas diarias vs meta (ultimos 30 dias)": las ventas validas de CADA dia (los dias sin ventas van en 0, sin huecos)
 * y la meta diaria (suma de las cajas activas con meta; null si no hay). Dias en hora de Bolivia; las anuladas no cuentan.
 */
async function ventasVsMeta({ periodo, ahora } = {}) {
  const v = ventanaDelGrafico(periodo, { ahora });
  const [{ rows }, meta] = await Promise.all([
    query(
      `SELECT d::date::text AS fecha, COALESCE(s.total, 0)::text AS ventas
         FROM generate_series($1::date, $2::date, interval '1 day') d
         LEFT JOIN (
           SELECT (fecha AT TIME ZONE '${ZONA}')::date AS dia, SUM(monto) AS total
             FROM pagos.transacciones
            WHERE estado <> 'Anulado' AND (fecha AT TIME ZONE '${ZONA}')::date BETWEEN $1::date AND $2::date
            GROUP BY 1
         ) s ON s.dia = d::date
        ORDER BY d`,
      [v.serie_desde, v.serie_hasta]
    ),
    obtenerMetaDiaria(),
  ]);
  const serie = rows.map((r) => ({ fecha: r.fecha, ventas: Number(r.ventas) }));
  const total = serie.reduce((a, x) => a + aCentavos(x.ventas), 0);
  return {
    periodo: v.periodo,
    desde: v.serie_desde,
    hasta: v.serie_hasta,
    dias: serie.length,
    meta_diaria: meta.meta_diaria,
    meta_error: meta.error,
    total_vendido: aMonto(total),
    dias_sobre_meta: meta.meta_diaria === null ? null : serie.filter((x) => aCentavos(x.ventas) >= aCentavos(meta.meta_diaria)).length,
    serie,
  };
}

module.exports = { tasaAnulacion, calcularPorcentaje, colorTasaAnulacion, UMBRALES_ANULACION, ventasVsMeta, ventanaDelGrafico, sumarDias, resumen, rangoDelPeriodo, calcularTicketPromedio, colorTicketPromedio, ventasEntre, ticketPromedio, hoyBolivia, UMBRALES_TICKET, ZONA };
