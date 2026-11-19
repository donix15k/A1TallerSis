// TDSI-209/212: el MODELO del reporte del Panel de KPIs (lo que va en cada seccion), compartido por el PDF y el Excel. Los valores salen de
// los mismos servicios de calculo del panel (kpiPanelService / integracionesService): el archivo dice lo mismo que la pantalla.
const { AppError } = require("../utils/AppError");
const { reunirPanel } = require("./kpiPanelService");
const { armarAlertas, numero, pct } = require("./kpiAlertasService");
const integraciones = require("./integracionesService");

// Las secciones de la ventana "Exportar reporte" (Incluir: Resumen de KPIs, Detalle por caja, Integraciones), en su orden.
const SECCIONES = ["resumen", "cajas", "integraciones"];
const TITULOS = { resumen: "Resumen de KPIs", cajas: "Detalle por caja", integraciones: "Integraciones" };
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const dd = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** ?secciones=resumen,cajas: al menos una, sin repetir ni inventar; se devuelven en el orden del reporte. */
function validarSecciones(valor) {
  const lista = (Array.isArray(valor) ? valor : String(valor ?? "").split(",")).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  if (lista.length === 0) throw new AppError(`Marque al menos una sección para el reporte (${SECCIONES.join(", ")}).`, 400, { secciones: valor ?? null });
  const desconocidas = lista.filter((s) => !SECCIONES.includes(s));
  if (desconocidas.length) throw new AppError(`Sección desconocida: ${desconocidas.join(", ")}. Use: ${SECCIONES.join(", ")}.`, 400, { secciones: valor });
  return SECCIONES.filter((s) => lista.includes(s));
}

/**
 * El periodo del reporte: ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD (lo que elige la ventana; por defecto el periodo del panel) o ?periodo=AAAA-MM.
 * El panel calcula por MES, asi que el rango debe ser un mes completo (del dia 1 al ultimo dia): si no, los valores del archivo no
 * coincidirian con los de la pantalla. Devuelve el periodo AAAA-MM o undefined (mes actual).
 */
function periodoDelReporte({ desde, hasta, periodo }) {
  const hayDesde = desde !== undefined && desde !== "" && desde !== null;
  const hayHasta = hasta !== undefined && hasta !== "" && hasta !== null;
  if (hayDesde !== hayHasta) throw new AppError("Indique 'desde' y 'hasta' (AAAA-MM-DD), o solo el 'periodo' (AAAA-MM).", 400, { desde, hasta });
  if (!hayDesde) return periodo;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(desde));
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(hasta));
  const real = (x) => x && new Date(`${x[0]}T00:00:00Z`).toISOString().slice(0, 10) === x[0];
  if (!real(m) || !real(f)) throw new AppError("'desde' y 'hasta' deben ser fechas reales con formato AAAA-MM-DD.", 400, { desde, hasta });
  const mes = `${m[1]}-${m[2]}`;
  const ultimo = new Date(Date.UTC(Number(f[1]), Number(f[2]), 0)).getUTCDate();
  if (mes !== `${f[1]}-${f[2]}` || m[3] !== "01" || Number(f[3]) !== ultimo) {
    throw new AppError("El reporte se genera por mes completo, igual que el panel: elija del día 1 al último día del mismo mes.", 400, { desde, hasta });
  }
  return mes;
}

const sinDatos = (error) => ({ disponible: false, error: error || "Sin datos", valor: null, color: null, detalle: null });

/** Las 7 filas del "Resumen de KPIs": valor, unidad, color y una linea de detalle; un KPI sin datos va sin valor ni color. */
function filasKpis({ propios, metas, cuadre, aceptacion, proveedores }) {
  const t = Object.fromEntries((propios.datos?.tarjetas || []).map((x) => [x.id, x]));
  const fila = (id, nombre, unidad, base) => ({ id, nombre, unidad, ...base });
  const ticket = t.ticket_promedio;
  const anul = t.anulacion;
  const dev = t.devoluciones;
  const m = metas.datos;
  const c = cuadre.datos;
  const a = aceptacion.datos;
  const p = proveedores.datos;
  return [
    fila("ticket_promedio", "Ticket promedio", "Bs", ticket
      ? { disponible: true, error: null, valor: ticket.valor, color: ticket.color, detalle: `${numero(ticket.detalle.ventas_validas, 0)} ventas · Bs ${numero(ticket.detalle.total_vendido)} vendidos` }
      : sinDatos(propios.error)),
    fila("tasa_anulacion", "Tasa de anulación", "%", anul
      ? { disponible: true, error: null, valor: anul.valor, color: anul.color, detalle: `${numero(anul.detalle.anuladas, 0)} de ${numero(anul.detalle.emitidas, 0)} facturas` }
      : sinDatos(propios.error)),
    fila("tasa_devoluciones", "Tasa de devoluciones", "%", dev && dev.detalle.disponible !== false
      ? { disponible: true, error: null, valor: dev.valor, color: dev.color, detalle: `Bs ${numero(dev.detalle.monto_devuelto)} devueltos` }
      : sinDatos(dev?.detalle?.error || propios.error)),
    fila("cumplimiento_metas", "Cumplimiento de metas", "%", m
      ? { disponible: true, error: null, valor: m.general.porcentaje, color: m.general.color, detalle: m.general.porcentaje === null ? "Ninguna caja tiene meta" : `Bs ${numero(m.general.vendido)} de Bs ${numero(m.general.meta)} (${m.general.cajas_con_meta} cajas con meta)` }
      : sinDatos(metas.error)),
    fila("efectividad_cuadre", "Efectividad de cuadre", "%", c
      ? { disponible: true, error: null, valor: c.porcentaje, color: c.color, detalle: c.porcentaje === null ? "Sin turnos cerrados" : `${numero(c.turnos_cuadran, 0)} de ${numero(c.turnos_cerrados, 0)} turnos cuadran · Sobrantes Bs ${numero(c.sobrantes)} · Faltantes Bs ${numero(c.faltantes)}` }
      : sinDatos(cuadre.error)),
    fila("aceptacion_contable", "Aceptación contable", "%", a
      ? { disponible: true, error: null, valor: a.porcentaje, color: a.color, detalle: a.porcentaje === null ? "Sin asientos enviados" : `${numero(a.registrados, 0)} de ${numero(a.enviados, 0)} asientos · ${numero(a.rechazados, 0)} rechazados${a.incompleto ? " (datos incompletos)" : ""}` }
      : sinDatos(aceptacion.error)),
    fila("dias_pago_proveedores", "Días de pago a proveedores", "días", p
      ? { disponible: true, error: null, valor: p.valor, color: p.color, detalle: p.valor === null ? "Sin órdenes pagadas" : `${numero(p.ordenes_pagadas_total, 0)} órdenes pagadas · ${numero(p.ordenes_vencidas_total, 0)} vencidas` }
      : sinDatos(proveedores.error)),
  ];
}

function seccionCajas({ metas, cuadre }) {
  return {
    cumplimiento: metas.datos
      ? { disponible: true, error: null, general: metas.datos.general, cajas: metas.datos.cajas, umbrales: metas.datos.umbrales }
      : { disponible: false, error: metas.error, general: null, cajas: [] },
    cuadre: cuadre.datos
      ? {
          disponible: true, error: null, turnos_cerrados: cuadre.datos.turnos_cerrados, turnos_cuadran: cuadre.datos.turnos_cuadran, porcentaje: cuadre.datos.porcentaje, color: cuadre.datos.color,
          sobrantes: cuadre.datos.sobrantes, faltantes: cuadre.datos.faltantes, turnos_con_diferencia: cuadre.datos.turnos_con_diferencia, ultimos_turnos: cuadre.datos.ultimos_turnos,
        }
      : { disponible: false, error: cuadre.error, turnos_con_diferencia: [], ultimos_turnos: [] },
  };
}

async function seccionIntegraciones({ aceptacion, proveedores, periodo, token }) {
  let tarjetas = null;
  let errorTarjetas = null;
  try {
    tarjetas = (await integraciones.resumen({ token, periodo })).tarjetas;
  } catch (e) {
    errorTarjetas = e.message;
  }
  const p = proveedores.datos;
  return {
    tarjetas,
    error: errorTarjetas,
    asientos_rechazados: aceptacion.datos
      ? { disponible: true, total: aceptacion.datos.rechazados_total ?? aceptacion.datos.rechazados, lista: aceptacion.datos.rechazados_lista || [] }
      : { disponible: false, error: aceptacion.error, total: null, lista: [] },
    pago_proveedores: p
      ? { disponible: true, error: null, valor: p.valor, color: p.color, ordenes_vencidas_total: p.ordenes_vencidas_total, ordenes_vencidas: p.ordenes_vencidas, ordenes_pagadas_total: p.ordenes_pagadas_total, ordenes_pagadas: p.ordenes_pagadas }
      : { disponible: false, error: proveedores.error, ordenes_vencidas: [], ordenes_pagadas: [] },
  };
}

/**
 * TDSI-209/212: arma el reporte de un mes con las secciones elegidas. Nombre del archivo: KPIs_[periodo] (sin extension).
 * @returns { nombre_archivo, periodo, desde, hasta, titulo_periodo, generado_en, secciones, resumen?, cajas?, integraciones?, fuentes }
 */
async function construirReporte({ desde, hasta, periodo, secciones, token, ahora } = {}) {
  const lista = validarSecciones(secciones);
  const mes = periodoDelReporte({ desde, hasta, periodo });
  const panel = await reunirPanel({ periodo: mes, token, ahora, ultimos: 10, limiteAsientos: 100, limiteOrdenes: 50 });
  const { rango } = panel;
  const reporte = {
    nombre_archivo: `KPIs_${rango.periodo}`,
    periodo: rango.periodo,
    desde: rango.desde,
    hasta: rango.hasta,
    titulo_periodo: `${MESES[Number(rango.periodo.slice(5, 7)) - 1]} de ${rango.periodo.slice(0, 4)} (${dd(rango.desde)} – ${dd(rango.hasta)})`,
    generado_en: new Date().toISOString(),
    secciones: lista,
    fuentes: panel.fuentes,
  };
  if (lista.includes("resumen")) {
    reporte.resumen = { kpis: filasKpis(panel), alertas: armarAlertas(panel).map((a) => ({ nivel: a.nivel, tipo: a.tipo, mensaje: a.mensaje })) };
  }
  if (lista.includes("cajas")) reporte.cajas = seccionCajas(panel);
  if (lista.includes("integraciones")) reporte.integraciones = await seccionIntegraciones({ ...panel, periodo: rango.periodo, token });
  return reporte;
}

module.exports = { construirReporte, validarSecciones, periodoDelReporte, filasKpis, SECCIONES, TITULOS, dd, numero, pct };
