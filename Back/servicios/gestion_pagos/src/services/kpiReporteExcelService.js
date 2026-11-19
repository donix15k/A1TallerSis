const ExcelJS = require("exceljs");
const { TITULOS } = require("./kpiReporteService");
const { COLORES_CLAROS, textoValor, estadoTexto, fechaHora } = require("./kpiReporteFormato");

// TDSI-209/211: el Excel del reporte de KPIs: UNA HOJA por cada seccion marcada (mismo estilo que el Libro de Ventas: encabezado en negrita),
// con los valores como numeros y el estado pintado con su color del semaforo.

function encabezado(hoja, modelo, titulo) {
  hoja.addRow([`Vortrix · ${titulo}`]).font = { bold: true, size: 14 };
  hoja.addRow([`Periodo: ${modelo.titulo_periodo}`]);
  hoja.addRow([`Generado: ${fechaHora(modelo.generado_en)} (hora de Bolivia)`]);
  hoja.addRow([]);
}

function filaTitulo(hoja, texto) {
  hoja.addRow([]);
  const f = hoja.addRow([texto]);
  f.font = { bold: true, size: 12 };
  return f;
}

function filaCabecera(hoja, columnas) {
  const f = hoja.addRow(columnas);
  f.font = { bold: true };
  f.eachCell((c) => { c.border = { bottom: { style: "thin" } }; });
  return f;
}

/** Pinta la celda del estado con el color del semaforo (sin color: tal cual). */
function pintar(celda, color) {
  celda.value = estadoTexto(color);
  if (color && COLORES_CLAROS[color]) {
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES_CLAROS[color] } };
    celda.font = { bold: true };
  }
  celda.alignment = { horizontal: "center" };
}

function nota(hoja, texto) {
  const f = hoja.addRow([texto]);
  f.font = { italic: true, color: { argb: "FF6B7280" } };
}

function hojaResumen(libro, modelo) {
  const hoja = libro.addWorksheet(TITULOS.resumen);
  hoja.columns = [{ width: 32 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 70 }];
  encabezado(hoja, modelo, "Reporte de KPIs");
  filaCabecera(hoja, ["KPI", "Valor", "Unidad", "Estado", "Detalle"]);
  for (const k of modelo.resumen.kpis) {
    const f = hoja.addRow([k.nombre, k.valor, k.unidad, null, k.disponible ? k.detalle : `No disponible: ${k.error}`]);
    f.getCell(2).numFmt = "0.00";
    pintar(f.getCell(4), k.color);
  }
  filaTitulo(hoja, "Alertas del día");
  filaCabecera(hoja, ["Alerta", "Nivel"]);
  if (modelo.resumen.alertas.length === 0) nota(hoja, "Sin alertas: todo en orden.");
  for (const a of modelo.resumen.alertas) {
    const f = hoja.addRow([a.mensaje, null]);
    pintar(f.getCell(2), a.nivel);
  }
}

function hojaCajas(libro, modelo) {
  const hoja = libro.addWorksheet(TITULOS.cajas);
  hoja.columns = [{ width: 24 }, { width: 16 }, { width: 16 }, { width: 12 }, { width: 14 }, { width: 22 }];
  encabezado(hoja, modelo, "Detalle por caja");
  const { cumplimiento, cuadre } = modelo.cajas;

  filaTitulo(hoja, "Cumplimiento de metas");
  if (!cumplimiento.disponible) nota(hoja, `No disponible: ${cumplimiento.error}`);
  else {
    filaCabecera(hoja, ["Caja", "Vendido (Bs)", "Meta (Bs)", "Avance (%)", "Estado", "Origen de la meta"]);
    for (const c of cumplimiento.cajas) {
      const f = hoja.addRow([c.caja_nombre, c.vendido, c.meta, c.porcentaje, null, c.meta_origen === "mensual" ? "Meta mensual" : c.meta_origen === "diaria_por_dias" ? "Meta diaria x días" : "Sin meta"]);
      [2, 3, 4].forEach((i) => { f.getCell(i).numFmt = "0.00"; });
      pintar(f.getCell(5), c.color);
    }
    const g = hoja.addRow(["General", cumplimiento.general.vendido, cumplimiento.general.meta, cumplimiento.general.porcentaje, null, ""]);
    g.font = { bold: true };
    [2, 3, 4].forEach((i) => { g.getCell(i).numFmt = "0.00"; });
    pintar(g.getCell(5), cumplimiento.general.color);
  }

  filaTitulo(hoja, "Efectividad de cuadre");
  if (!cuadre.disponible) nota(hoja, `No disponible: ${cuadre.error}`);
  else {
    filaCabecera(hoja, ["Turnos cerrados", "Turnos que cuadran", "Efectividad (%)", "Estado", "Sobrantes (Bs)", "Faltantes (Bs)"]);
    const f = hoja.addRow([cuadre.turnos_cerrados, cuadre.turnos_cuadran, cuadre.porcentaje, null, cuadre.sobrantes, cuadre.faltantes]);
    [3, 5, 6].forEach((i) => { f.getCell(i).numFmt = "0.00"; });
    pintar(f.getCell(4), cuadre.color);
    filaTitulo(hoja, `Turnos con diferencia (${cuadre.turnos_con_diferencia.length})`);
    if (cuadre.turnos_con_diferencia.length === 0) nota(hoja, "Ningún turno cerró con diferencia.");
    else {
      filaCabecera(hoja, ["Turno", "Caja", "Cajero", "Diferencia (Bs)", "Tipo"]);
      for (const t of cuadre.turnos_con_diferencia) {
        const r = hoja.addRow([t.turno, t.caja_nombre, t.cajero, t.diferencia, t.tipo]);
        r.getCell(4).numFmt = "0.00";
      }
    }
  }
}

function hojaIntegraciones(libro, modelo) {
  const hoja = libro.addWorksheet(TITULOS.integraciones);
  hoja.columns = [{ width: 26 }, { width: 28 }, { width: 18 }, { width: 14 }, { width: 50 }];
  encabezado(hoja, modelo, "Integraciones y proveedores");
  const i = modelo.integraciones;

  filaTitulo(hoja, "Estado de las integraciones");
  if (!i.tarjetas) nota(hoja, `No disponible: ${i.error}`);
  else {
    filaCabecera(hoja, ["Integración", "Indicador", "Valor", "Estado", "Detalle"]);
    const { contabilidad: c, compras: p, marketplace: m } = i.tarjetas;
    const a = hoja.addRow(["Contabilidad", "Aceptación", c.disponible ? c.porcentaje : null, null, c.disponible ? `${c.registrados} de ${c.enviados} asientos` : `No disponible: ${c.error}`]);
    a.getCell(3).numFmt = "0.00";
    pintar(a.getCell(4), c.color);
    const b = hoja.addRow(["Compras / Proveedores", "Órdenes recibidas", p.ordenes_recibidas, null, `Reintentos: ${p.mensajes_en_reintento} · Errores: ${p.mensajes_en_error}${p.ultimo_mensaje_en ? ` · Último mensaje: ${fechaHora(p.ultimo_mensaje_en)}` : ""}`]);
    pintar(b.getCell(4), p.color);
    const d = hoja.addRow(["Marketplace", "Pedidos sincronizados", m.pedidos_sincronizados, null, `Reintentos: ${m.mensajes_en_reintento} · Errores: ${m.mensajes_en_error}`]);
    pintar(d.getCell(4), m.color);
  }

  filaTitulo(hoja, `Asientos rechazados (${i.asientos_rechazados.total ?? "sin datos"})`);
  if (!i.asientos_rechazados.disponible) nota(hoja, `No disponible: ${i.asientos_rechazados.error}`);
  else if (i.asientos_rechazados.lista.length === 0) nota(hoja, "Ningún asiento rechazado.");
  else {
    filaCabecera(hoja, ["Referencia", "Tipo", "Origen", "Enviado", "Motivo"]);
    for (const r of i.asientos_rechazados.lista) hoja.addRow([r.referencia, r.tipo, r.origen, fechaHora(r.enviado_en), r.motivo]);
  }

  const pp = i.pago_proveedores;
  filaTitulo(hoja, "Pago a proveedores");
  if (!pp.disponible) nota(hoja, `No disponible: ${pp.error}`);
  else {
    filaCabecera(hoja, ["Indicador", "Días promedio", "Estado", "Órdenes vencidas"]);
    const f = hoja.addRow(["Días de pago a proveedores", pp.valor, null, pp.ordenes_vencidas_total]);
    f.getCell(2).numFmt = "0.0";
    pintar(f.getCell(3), pp.color);
    for (const [titulo, lista, estado] of [["Órdenes vencidas", pp.ordenes_vencidas, "VENCIDA"], ["Órdenes pagadas", pp.ordenes_pagadas, "PAGADA"]]) {
      filaTitulo(hoja, `${titulo} (${lista.length})`);
      if (lista.length === 0) nota(hoja, "Ninguna.");
      else {
        filaCabecera(hoja, ["Orden", "Proveedor", "Monto (Bs)", "Días", "Estado"]);
        for (const o of lista) {
          const r = hoja.addRow([o.orden, o.proveedor, o.monto, o.dias, estado]);
          r.getCell(3).numFmt = "0.00";
          r.getCell(4).numFmt = "0.0";
        }
      }
    }
  }
}

/** TDSI-211: el Excel del reporte: una hoja por seccion elegida, en el orden del reporte. */
async function generarReporteExcel(modelo) {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Vortrix";
  libro.created = new Date(modelo.generado_en);
  if (modelo.resumen) hojaResumen(libro, modelo);
  if (modelo.cajas) hojaCajas(libro, modelo);
  if (modelo.integraciones) hojaIntegraciones(libro, modelo);
  return libro.xlsx.writeBuffer();
}

module.exports = { generarReporteExcel, textoValor };
