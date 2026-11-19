const { query } = require("../config/db");
const { ZONA_HORARIA } = require("../utils/fecha");
const { rangoDelPeriodo } = require("../utils/periodo");
const { AppError } = require("../utils/AppError");
const { limitesDe, colorSegun, INICIALES } = require("./objetivosProxy");

// TDSI-181: KPI 7 · Dias promedio de pago a proveedores. VERDE <= 7 dias, AMARILLO 8 - 15 dias, ROJO > 15 dias.
const UMBRALES_DIAS_PAGO = { verde: 7, amarillo: 15 };
const DIAS_PARA_VENCER = 15; // una orden aprobada con MAS de 15 dias sin pagar esta vencida
const LIMITE_POR_DEFECTO = 20;
const LIMITE_MAXIMO = 100;

const redondear1 = (n) => Math.round(Number(n) * 10) / 10;

/** VERDE hasta 7 dias, AMARILLO por encima de 7 y hasta 15, ROJO por encima de 15 (o los limites vigentes que se pasen: TDSI-191). */
function colorDiasPago(dias, limites = INICIALES.dias_pago_proveedores) {
  return colorSegun(dias, limites);
}

function validarLimite(valor) {
  if (valor === undefined || valor === null || valor === "") return LIMITE_POR_DEFECTO;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > LIMITE_MAXIMO) {
    throw new AppError(`'limite' debe ser un entero entre 1 y ${LIMITE_MAXIMO}.`, 400, { limite: valor });
  }
  return n;
}

const aOrden = (r, estado) => ({
  orden: r.numero,
  proveedor: r.proveedor,
  monto: Number(r.monto),
  dias: redondear1(r.dias),
  estado,
  aprobada_en: r.aprobada_en,
  pagada_en: r.pagada_en ?? null,
});

/**
 * TDSI-181/182: los dias de pago a proveedores del mes. Una orden llega a esta base YA APROBADA por Compras (aprobada_en = creado_en)
 * y el administrador la liquida (pagada_en = liquidada_en).
 *  - promedio ("valor") = suma de dias (aprobacion -> pago) / ordenes pagadas, de las ordenes PAGADAS dentro del periodo (hora de
 *    Bolivia). Sin ordenes pagadas no hay promedio: valor y color null (sin_ordenes_pagadas).
 *  - ordenes_vencidas: ordenes aprobadas hasta el fin del periodo que HOY siguen sin pagar y llevan mas de 15 dias; la mas
 *    atrasada primero. "ahora" mide su antiguedad.
 *  - ordenes_pagadas: las pagadas del periodo, la mas reciente primero (?limite=, 20 por defecto, maximo 100).
 */
async function diasPagoProveedores({ periodo, limite, hoy, ahora = new Date(), token } = {}) {
  const rango = rangoDelPeriodo(periodo, { hoy });
  const limites = await limitesDe("dias_pago_proveedores", { token });
  const tope = validarLimite(limite);

  const pagadas = await query(
    `SELECT numero, proveedor_razon_social AS proveedor, monto, creado_en AS aprobada_en, liquidada_en AS pagada_en,
            EXTRACT(EPOCH FROM (liquidada_en - creado_en)) / 86400 AS dias
       FROM proveedores.ordenes_pago
      WHERE estado = 'LIQUIDADA' AND liquidada_en IS NOT NULL
        AND (liquidada_en AT TIME ZONE '${ZONA_HORARIA}')::date BETWEEN $1::date AND $2::date
      ORDER BY liquidada_en DESC, id DESC`,
    [rango.desde, rango.hasta]
  );
  const vencidas = await query(
    `SELECT numero, proveedor_razon_social AS proveedor, monto, creado_en AS aprobada_en,
            EXTRACT(EPOCH FROM ($3::timestamptz - creado_en)) / 86400 AS dias
       FROM proveedores.ordenes_pago
      WHERE estado = 'PENDIENTE'
        AND (creado_en AT TIME ZONE '${ZONA_HORARIA}')::date <= $2::date
        AND EXTRACT(EPOCH FROM ($3::timestamptz - creado_en)) / 86400 > $1
      ORDER BY creado_en ASC, id ASC`,
    [DIAS_PARA_VENCER, rango.hasta, ahora]
  );

  // TDSI-182: tarjeta "Compras / Proveedores" del Monitor: ordenes de pago que llegaron de Compras en el periodo y cuando llego la ultima
  const recibidas = await query(
    `SELECT COUNT(*)::int AS total, MAX(creado_en) AS ultima
       FROM proveedores.ordenes_pago
      WHERE (creado_en AT TIME ZONE '${ZONA_HORARIA}')::date BETWEEN $1::date AND $2::date`,
    [rango.desde, rango.hasta]
  );

  const n = pagadas.rows.length;
  const suma = pagadas.rows.reduce((a, r) => a + Number(r.dias), 0);
  const valor = n ? redondear1(suma / n) : null;

  return {
    ...rango,
    valor,
    color: valor === null ? null : colorDiasPago(valor, limites),
    ordenes_recibidas: recibidas.rows[0].total,
    ultima_orden_recibida_en: recibidas.rows[0].ultima,
    ordenes_pagadas_total: n,
    sin_ordenes_pagadas: n === 0,
    ordenes_vencidas_total: vencidas.rows.length,
    ordenes_vencidas: vencidas.rows.slice(0, LIMITE_MAXIMO).map((r) => aOrden(r, "VENCIDA")),
    ordenes_pagadas: pagadas.rows.slice(0, tope).map((r) => aOrden(r, "PAGADA")),
    umbrales: { verde: limites.verde, amarillo: limites.amarillo },
    dias_para_vencer: DIAS_PARA_VENCER,
  };
}

module.exports = { diasPagoProveedores, colorDiasPago, UMBRALES_DIAS_PAGO, DIAS_PARA_VENCER };
