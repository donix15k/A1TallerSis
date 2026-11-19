// TDSI-192: "⚠ Alertas del día" del Resumen del Panel de KPIs: lo que esta fuera de lo esperado, primero lo ROJO y despues lo AMARILLO.
// Junta (en paralelo, tolerando que un servicio no responda) los KPIs propios y los de Caja, Facturacion y Pagos a Proveedores.
const { resumen, rangoDelPeriodo } = require("./kpiService");
const externos = require("./kpiExternos");

const NIVELES = ["ROJO", "AMARILLO"];
const PRIORIDAD_TIPO = ["CAJA", "CUADRE", "ORDEN_VENCIDA", "ASIENTOS_RECHAZADOS", "KPI"]; // el orden del mockup dentro de cada color

/** 1208.2 -> "1.208,20": numeros a la boliviana para los textos de las alertas. */
function numero(n, decimales = 2) {
  const [entero, dec = ""] = Number(n).toFixed(decimales).split(".");
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimales > 0 ? `${miles},${dec}` : miles;
}
const pct = (n) => `${numero(n, Number.isInteger(Number(n)) ? 0 : 1)} %`;

const alerta = ({ nivel, tipo, indicador, mensaje, valor = null, detalle = {} }) => ({ nivel, tipo, indicador, mensaje, valor, detalle });
const esAlerta = (color) => NIVELES.includes(color);

/** Las alertas de los 3 KPIs propios (Ticket promedio, Anulacion, Devoluciones) que estan en ROJO o AMARILLO. */
function alertasPropias(tarjetas) {
  const out = [];
  const por = Object.fromEntries(tarjetas.map((t) => [t.id, t]));
  const t = por.ticket_promedio;
  if (t && esAlerta(t.color)) out.push(alerta({ nivel: t.color, tipo: "KPI", indicador: "ticket_promedio", mensaje: `Ticket promedio de Bs ${numero(t.valor)}`, valor: t.valor }));
  const a = por.anulacion;
  if (a && esAlerta(a.color)) out.push(alerta({ nivel: a.color, tipo: "KPI", indicador: "tasa_anulacion", mensaje: `Anulación al ${pct(a.valor)}: ${numero(a.detalle.anuladas, 0)} de ${numero(a.detalle.emitidas, 0)} facturas`, valor: a.valor, detalle: { anuladas: a.detalle.anuladas, emitidas: a.detalle.emitidas } }));
  const d = por.devoluciones;
  if (d && esAlerta(d.color)) out.push(alerta({ nivel: d.color, tipo: "KPI", indicador: "tasa_devoluciones", mensaje: `Devoluciones al ${pct(d.valor)}: Bs ${numero(d.detalle.monto_devuelto)} devueltos`, valor: d.valor, detalle: { monto_devuelto: d.detalle.monto_devuelto } }));
  return out;
}

function alertasCajas(datos) {
  if (!datos) return [];
  const out = [];
  for (const c of datos.cajas || []) {
    if (!esAlerta(c.color)) continue;
    out.push(alerta({ nivel: c.color, tipo: "CAJA", indicador: "cumplimiento_metas", mensaje: `${c.caja_nombre} al ${pct(c.porcentaje)} de su meta`, valor: c.porcentaje, detalle: { caja_id: c.caja_id, vendido: c.vendido, meta: c.meta } }));
  }
  return out;
}

function alertasCuadre(datos) {
  if (!datos || !esAlerta(datos.color)) return [];
  const conDiferencia = datos.turnos_con_diferencia ? datos.turnos_con_diferencia.length : datos.turnos_cerrados - datos.turnos_cuadran;
  return [alerta({ nivel: datos.color, tipo: "CUADRE", indicador: "efectividad_cuadre", mensaje: `Cuadre ${pct(datos.porcentaje)}: ${numero(conDiferencia, 0)} ${conDiferencia === 1 ? "turno" : "turnos"} con diferencia`, valor: datos.porcentaje, detalle: { turnos_cerrados: datos.turnos_cerrados, turnos_cuadran: datos.turnos_cuadran, sobrantes: datos.sobrantes, faltantes: datos.faltantes } })];
}

function alertasProveedores(datos) {
  if (!datos) return [];
  const out = (datos.ordenes_vencidas || []).map((o) =>
    alerta({ nivel: "ROJO", tipo: "ORDEN_VENCIDA", indicador: "dias_pago_proveedores", mensaje: `${o.orden} vencida (${numero(Math.floor(o.dias), 0)} días)`, valor: o.dias, detalle: { orden: o.orden, proveedor: o.proveedor, monto: o.monto } })
  );
  // la lista de vencidas viene recortada: si hay mas que las traidas, las demas se resumen en una sola alerta
  const faltan = (datos.ordenes_vencidas_total ?? out.length) - out.length;
  if (faltan > 0) out.push(alerta({ nivel: "ROJO", tipo: "ORDEN_VENCIDA", indicador: "dias_pago_proveedores", mensaje: `${faltan} órdenes vencidas más`, valor: faltan }));
  if (esAlerta(datos.color)) out.push(alerta({ nivel: datos.color, tipo: "KPI", indicador: "dias_pago_proveedores", mensaje: `Pago a proveedores en ${numero(datos.valor, 1)} días`, valor: datos.valor }));
  return out;
}

function alertasContabilidad(datos) {
  if (!datos) return [];
  if (datos.rechazados > 0) {
    // con asientos rechazados siempre hay que actuar: ROJO si el KPI esta en rojo, si no AMARILLO
    return [alerta({ nivel: datos.color === "ROJO" ? "ROJO" : "AMARILLO", tipo: "ASIENTOS_RECHAZADOS", indicador: "aceptacion_contable", mensaje: `${numero(datos.rechazados, 0)} ${datos.rechazados === 1 ? "asiento rechazado" : "asientos rechazados"} por Contabilidad`, valor: datos.rechazados, detalle: { porcentaje: datos.porcentaje, enviados: datos.enviados, registrados: datos.registrados } })];
  }
  if (esAlerta(datos.color)) return [alerta({ nivel: datos.color, tipo: "KPI", indicador: "aceptacion_contable", mensaje: `Aceptación contable al ${pct(datos.porcentaje)}`, valor: datos.porcentaje })];
  return [];
}

/**
 * TDSI-192: GET /api/kpis/alertas?periodo=AAAA-MM. Una linea por alerta, primero las ROJAS y luego las AMARILLAS:
 *   - KPIs del periodo en ROJO o AMARILLO (ticket promedio, anulacion, devoluciones, cuadre, aceptacion, dias de pago),
 *   - cada caja en ROJO o AMARILLO frente a su meta ("Caja 3 al 61 % de su meta"),
 *   - cada orden de pago vencida ("OP-2026-0131 vencida (18 días)") y los asientos rechazados por Contabilidad.
 * Un indicador sin datos no genera alerta. Si un servicio no responde, sus alertas no aparecen y se informa en "fuentes".
 */
async function alertas({ periodo, token, ahora } = {}) {
  const rango = rangoDelPeriodo(periodo, { ahora });
  const p = rango.periodo;
  const [propios, metas, cuadre, proveedores, contabilidad] = await Promise.all([
    resumen({ periodo: p, token, ahora }).then((r) => ({ datos: r, error: null }), (e) => ({ datos: null, error: e.message })),
    externos.cumplimientoMetas({ periodo: p, token }),
    externos.cuadreCaja({ periodo: p, token }),
    externos.diasPagoProveedores({ periodo: p, token, limite: 1 }),
    externos.aceptacionContable({ periodo: p, token, limite: 1 }),
  ]);

  const todas = [
    ...(propios.datos ? alertasPropias(propios.datos.tarjetas) : []),
    ...alertasCajas(metas.datos),
    ...alertasCuadre(cuadre.datos),
    ...alertasProveedores(proveedores.datos),
    ...alertasContabilidad(contabilidad.datos),
  ];
  const ordenadas = todas
    .map((a, i) => ({ a, i }))
    .sort((x, y) => NIVELES.indexOf(x.a.nivel) - NIVELES.indexOf(y.a.nivel) || PRIORIDAD_TIPO.indexOf(x.a.tipo) - PRIORIDAD_TIPO.indexOf(y.a.tipo) || x.i - y.i)
    .map((x) => x.a);

  const fuente = (origen, r) => ({ origen, ok: !r.error, error: r.error });
  return {
    ...rango,
    generado_en: new Date().toISOString(),
    total: ordenadas.length,
    rojas: ordenadas.filter((a) => a.nivel === "ROJO").length,
    amarillas: ordenadas.filter((a) => a.nivel === "AMARILLO").length,
    alertas: ordenadas,
    fuentes: [fuente("gestion_pagos", propios), fuente("gestion_caja_metas", metas), fuente("gestion_caja_cuadre", cuadre), fuente("pagos_proveedores", proveedores), fuente("facturacion", contabilidad)],
  };
}

module.exports = { alertas, numero };
