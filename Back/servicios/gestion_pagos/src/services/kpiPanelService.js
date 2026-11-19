// TDSI-192/212: UN solo lugar que reune los datos del Panel de KPIs de un mes (los 3 KPIs propios y los de Caja, Facturacion y Pagos a
// Proveedores). Lo usan las alertas del dia y el reporte PDF/Excel: asi los valores del archivo son EXACTAMENTE los del panel. Cada fuente
// es tolerante: si un servicio no responde, esa parte queda { datos: null, error } y el resto sigue.
const { resumen, rangoDelPeriodo } = require("./kpiService");
const externos = require("./kpiExternos");

/**
 * { rango, propios, metas, cuadre, aceptacion, proveedores, fuentes }
 *   propios: { datos: resumen() | null, error }           (ticket promedio, anulacion, devoluciones)
 *   metas / cuadre / aceptacion / proveedores: { datos, error }  (KPI 4, 5, 6 y 7 de los demas servicios)
 * ultimos / limiteAsientos / limiteOrdenes: cuantas filas de cada lista pide el llamador (las alertas piden pocas, el reporte mas).
 */
async function reunirPanel({ periodo, token, ahora, ultimos = 5, limiteAsientos = 50, limiteOrdenes = 20 } = {}) {
  const rango = rangoDelPeriodo(periodo, { ahora });
  const p = rango.periodo;
  const [propios, metas, cuadre, aceptacion, proveedores] = await Promise.all([
    resumen({ periodo: p, token, ahora }).then((r) => ({ datos: r, error: null }), (e) => ({ datos: null, error: e.message })),
    externos.cumplimientoMetas({ periodo: p, token }),
    externos.cuadreCaja({ periodo: p, token, ultimos }),
    externos.aceptacionContable({ periodo: p, token, limite: limiteAsientos }),
    externos.diasPagoProveedores({ periodo: p, token, limite: limiteOrdenes }),
  ]);
  const fuente = (origen, r) => ({ origen, ok: !r.error, error: r.error });
  return {
    rango,
    propios,
    metas,
    cuadre,
    aceptacion,
    proveedores,
    fuentes: [fuente("gestion_pagos", propios), fuente("gestion_caja_metas", metas), fuente("gestion_caja_cuadre", cuadre), fuente("pagos_proveedores", proveedores), fuente("facturacion", aceptacion)],
  };
}

module.exports = { reunirPanel };
