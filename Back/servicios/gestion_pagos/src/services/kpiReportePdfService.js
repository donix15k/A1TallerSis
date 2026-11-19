const PDFDocument = require("pdfkit");
const { TITULOS } = require("./kpiReporteService");
const { COLORES, textoValor, bs, numeroCorto, estadoTexto, fechaHora } = require("./kpiReporteFormato");

// TDSI-209/210: el PDF del reporte de KPIs: A4 con el titulo del periodo, una seccion por cada una elegida y el estado de cada valor con su
// punto de color del semaforo. Usa la misma fuente base del resto de PDFs del proyecto (pdfkit).
const MARGEN = 40;
const ANCHO = 595.28 - MARGEN * 2;
const AZUL = "#06152F";
const GRIS = "#6B7280";
const FUENTE = "Helvetica";
const NEGRITA = "Helvetica-Bold";

const fondoPagina = (doc) => doc.page.height - MARGEN - 20; // deja sitio para el pie

function asegurarEspacio(doc, alto) {
  if (doc.y + alto > fondoPagina(doc)) doc.addPage();
}

function punto(doc, x, y, color) {
  doc.save().circle(x + 4, y + 4.5, 4).fill(COLORES[color] || "#9CA3AF").restore();
}

function tituloSeccion(doc, texto) {
  asegurarEspacio(doc, 60);
  doc.moveDown(0.8).font(NEGRITA).fontSize(13).fillColor(AZUL).text(texto, MARGEN, doc.y, { width: ANCHO });
  doc.moveTo(MARGEN, doc.y + 2).lineTo(MARGEN + ANCHO, doc.y + 2).strokeColor(AZUL).lineWidth(1).stroke();
  doc.moveDown(0.6).fillColor("#000").font(FUENTE).fontSize(9);
}

function subtitulo(doc, texto) {
  asegurarEspacio(doc, 50);
  doc.moveDown(0.5).font(NEGRITA).fontSize(10.5).fillColor(AZUL).text(texto, MARGEN, doc.y, { width: ANCHO });
  doc.moveDown(0.3).fillColor("#000").font(FUENTE).fontSize(9);
}

function nota(doc, texto) {
  asegurarEspacio(doc, 20);
  doc.font(FUENTE).fontSize(9).fillColor(GRIS).text(texto, MARGEN, doc.y, { width: ANCHO });
  doc.fillColor("#000").moveDown(0.3);
}

/**
 * Una tabla: columnas [{ titulo, ancho (fraccion del ancho), alinear }], filas [[celda]] donde una celda es texto o { texto, color } (con
 * punto de color). Repite el encabezado en cada pagina nueva.
 */
function tabla(doc, columnas, filas) {
  const anchos = columnas.map((c) => c.ancho * ANCHO);
  const x0 = columnas.map((_, i) => MARGEN + anchos.slice(0, i).reduce((a, b) => a + b, 0));

  const cabecera = () => {
    asegurarEspacio(doc, 40);
    const y = doc.y;
    doc.font(NEGRITA).fontSize(8.5).fillColor(AZUL);
    columnas.forEach((c, i) => doc.text(c.titulo, x0[i] + 3, y, { width: anchos[i] - 6, align: c.alinear || "left" }));
    doc.moveTo(MARGEN, doc.y + 2).lineTo(MARGEN + ANCHO, doc.y + 2).strokeColor("#D1D5DB").lineWidth(0.7).stroke();
    doc.y += 5;
    doc.font(FUENTE).fontSize(9).fillColor("#000");
  };
  cabecera();

  for (const fila of filas) {
    const celdas = fila.map((c) => (c !== null && typeof c === "object" ? c : { texto: c === null || c === undefined ? "" : String(c) }));
    doc.font(FUENTE).fontSize(9);
    const alto = Math.max(14, ...celdas.map((c, i) => doc.heightOfString(c.texto, { width: anchos[i] - 6 - (c.color ? 12 : 0) }) + 4));
    if (doc.y + alto > fondoPagina(doc)) {
      doc.addPage();
      cabecera();
    }
    const y = doc.y;
    celdas.forEach((c, i) => {
      let x = x0[i] + 3;
      if (c.color) {
        punto(doc, x, y, c.color);
        x += 12;
      }
      doc.fillColor(c.negrita ? "#000" : "#111827").font(c.negrita ? NEGRITA : FUENTE).text(c.texto, x, y, { width: anchos[i] - (x - x0[i]) - 3, align: columnas[i].alinear || "left" });
    });
    doc.y = y + alto;
    doc.moveTo(MARGEN, doc.y - 1).lineTo(MARGEN + ANCHO, doc.y - 1).strokeColor("#F3F4F6").lineWidth(0.5).stroke();
  }
  doc.moveDown(0.4);
}

const conEstado = (color) => (color ? { texto: color, color, negrita: true } : { texto: estadoTexto(color) });

function seccionResumen(doc, modelo) {
  tituloSeccion(doc, TITULOS.resumen);
  tabla(
    doc,
    [{ titulo: "KPI", ancho: 0.24 }, { titulo: "Valor", ancho: 0.14, alinear: "right" }, { titulo: "Estado", ancho: 0.14 }, { titulo: "Detalle", ancho: 0.48 }],
    modelo.resumen.kpis.map((k) => [k.nombre, { texto: textoValor(k.valor, k.unidad), negrita: true }, conEstado(k.color), k.disponible ? k.detalle : `No disponible: ${k.error}`])
  );
  subtitulo(doc, "Alertas del día");
  if (modelo.resumen.alertas.length === 0) nota(doc, "Sin alertas: todo en orden.");
  else tabla(doc, [{ titulo: "Alerta", ancho: 0.8 }, { titulo: "Nivel", ancho: 0.2 }], modelo.resumen.alertas.map((a) => [a.mensaje, conEstado(a.nivel)]));
}

function seccionCajas(doc, modelo) {
  tituloSeccion(doc, TITULOS.cajas);
  const { cumplimiento, cuadre } = modelo.cajas;
  subtitulo(doc, "Cumplimiento de metas");
  if (!cumplimiento.disponible) nota(doc, `No disponible: ${cumplimiento.error}`);
  else {
    const filas = cumplimiento.cajas.map((c) => [c.caja_nombre, bs(c.vendido), c.meta === null ? "Sin meta" : bs(c.meta), c.porcentaje === null ? "—" : `${numeroCorto(c.porcentaje)} %`, conEstado(c.color)]);
    const g = cumplimiento.general;
    filas.push([{ texto: "General", negrita: true }, { texto: bs(g.vendido), negrita: true }, { texto: g.meta ? bs(g.meta) : "Sin meta", negrita: true }, { texto: g.porcentaje === null ? "—" : `${numeroCorto(g.porcentaje)} %`, negrita: true }, conEstado(g.color)]);
    tabla(doc, [{ titulo: "Caja", ancho: 0.24 }, { titulo: "Vendido", ancho: 0.2, alinear: "right" }, { titulo: "Meta", ancho: 0.2, alinear: "right" }, { titulo: "Avance", ancho: 0.16, alinear: "right" }, { titulo: "Estado", ancho: 0.2 }], filas);
  }
  subtitulo(doc, "Efectividad de cuadre");
  if (!cuadre.disponible) nota(doc, `No disponible: ${cuadre.error}`);
  else {
    tabla(
      doc,
      [{ titulo: "Turnos cerrados", ancho: 0.16, alinear: "right" }, { titulo: "Cuadran", ancho: 0.14, alinear: "right" }, { titulo: "Efectividad", ancho: 0.16, alinear: "right" }, { titulo: "Estado", ancho: 0.16 }, { titulo: "Sobrantes", ancho: 0.19, alinear: "right" }, { titulo: "Faltantes", ancho: 0.19, alinear: "right" }],
      [[String(cuadre.turnos_cerrados), String(cuadre.turnos_cuadran), textoValor(cuadre.porcentaje, "%"), conEstado(cuadre.color), bs(cuadre.sobrantes), bs(cuadre.faltantes)]]
    );
    subtitulo(doc, `Turnos con diferencia (${cuadre.turnos_con_diferencia.length})`);
    if (cuadre.turnos_con_diferencia.length === 0) nota(doc, "Ningún turno cerró con diferencia.");
    else tabla(doc, [{ titulo: "Turno", ancho: 0.17 }, { titulo: "Caja", ancho: 0.22 }, { titulo: "Cajero", ancho: 0.25 }, { titulo: "Diferencia", ancho: 0.18, alinear: "right" }, { titulo: "Tipo", ancho: 0.18 }], cuadre.turnos_con_diferencia.map((t) => [t.turno, t.caja_nombre, t.cajero, bs(t.diferencia), t.tipo]));
  }
}

function seccionIntegraciones(doc, modelo) {
  tituloSeccion(doc, TITULOS.integraciones);
  const i = modelo.integraciones;
  subtitulo(doc, "Estado de las integraciones");
  if (!i.tarjetas) nota(doc, `No disponible: ${i.error}`);
  else {
    const { contabilidad: c, compras: p, marketplace: m } = i.tarjetas;
    tabla(
      doc,
      [{ titulo: "Integración", ancho: 0.22 }, { titulo: "Indicador", ancho: 0.3 }, { titulo: "Estado", ancho: 0.14 }, { titulo: "Detalle", ancho: 0.34 }],
      [
        ["Contabilidad", c.disponible ? `Aceptación ${textoValor(c.porcentaje, "%")}` : "Aceptación", conEstado(c.color), c.disponible ? `${c.registrados} de ${c.enviados} asientos` : `No disponible: ${c.error}`],
        ["Compras / Proveedores", `${p.ordenes_recibidas ?? "—"} órdenes recibidas`, conEstado(p.color), `Reintentos: ${p.mensajes_en_reintento} · Errores: ${p.mensajes_en_error}${p.ultimo_mensaje_en ? ` · Último: ${fechaHora(p.ultimo_mensaje_en)}` : ""}`],
        ["Marketplace", `${m.pedidos_sincronizados} pedidos sincronizados`, conEstado(m.color), `Reintentos: ${m.mensajes_en_reintento} · Errores: ${m.mensajes_en_error}`],
      ]
    );
  }
  subtitulo(doc, `Asientos rechazados (${i.asientos_rechazados.total ?? "sin datos"})`);
  if (!i.asientos_rechazados.disponible) nota(doc, `No disponible: ${i.asientos_rechazados.error}`);
  else if (i.asientos_rechazados.lista.length === 0) nota(doc, "Ningún asiento rechazado.");
  else tabla(doc, [{ titulo: "Referencia", ancho: 0.2 }, { titulo: "Tipo", ancho: 0.22 }, { titulo: "Motivo", ancho: 0.58 }], i.asientos_rechazados.lista.map((r) => [r.referencia, r.tipo, r.motivo]));

  const pp = i.pago_proveedores;
  subtitulo(doc, "Pago a proveedores");
  if (!pp.disponible) nota(doc, `No disponible: ${pp.error}`);
  else {
    tabla(doc, [{ titulo: "Días promedio de pago", ancho: 0.4 }, { titulo: "Estado", ancho: 0.3 }, { titulo: "Órdenes vencidas", ancho: 0.3, alinear: "right" }], [[textoValor(pp.valor, "días"), conEstado(pp.color), String(pp.ordenes_vencidas_total)]]);
    for (const [titulo, lista, estado, color] of [["Órdenes vencidas", pp.ordenes_vencidas, "VENCIDA", "ROJO"], ["Órdenes pagadas", pp.ordenes_pagadas, "PAGADA", "VERDE"]]) {
      subtitulo(doc, `${titulo} (${lista.length})`);
      if (lista.length === 0) nota(doc, "Ninguna.");
      else tabla(doc, [{ titulo: "Orden", ancho: 0.2 }, { titulo: "Proveedor", ancho: 0.3 }, { titulo: "Monto", ancho: 0.18, alinear: "right" }, { titulo: "Días", ancho: 0.1, alinear: "right" }, { titulo: "Estado", ancho: 0.22 }], lista.map((o) => [o.orden, o.proveedor, bs(o.monto), numeroCorto(o.dias), { texto: estado, color, negrita: true }]));
    }
  }
}

/**
 * TDSI-210: el PDF del reporte de KPIs con solo las secciones elegidas, sus valores y sus colores. Devuelve un Buffer.
 * comprimir=false deja el contenido legible (para las pruebas).
 */
function generarReportePdf(modelo, { comprimir = true } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGEN, bufferPages: true, compress: comprimir, info: { Title: modelo.nombre_archivo, Author: "Vortrix", Subject: `Reporte de KPIs ${modelo.periodo}` } });
    const trozos = [];
    doc.on("data", (t) => trozos.push(t));
    doc.on("end", () => resolve(Buffer.concat(trozos)));
    doc.on("error", reject);

    doc.font(NEGRITA).fontSize(20).fillColor(AZUL).text("Reporte de KPIs", MARGEN, MARGEN, { width: ANCHO });
    doc.font(FUENTE).fontSize(11).fillColor("#111827").text(modelo.titulo_periodo, MARGEN, doc.y + 2, { width: ANCHO });
    doc.fontSize(8.5).fillColor(GRIS).text(`Generado: ${fechaHora(modelo.generado_en)} (hora de Bolivia) · Secciones: ${modelo.secciones.map((s) => TITULOS[s]).join(", ")}`, MARGEN, doc.y + 2, { width: ANCHO });
    doc.fillColor("#000");

    if (modelo.resumen) seccionResumen(doc, modelo);
    if (modelo.cajas) seccionCajas(doc, modelo);
    if (modelo.integraciones) seccionIntegraciones(doc, modelo);

    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(paginas.start + i);
      doc.font(FUENTE).fontSize(8).fillColor(GRIS).text(`${modelo.nombre_archivo} · Página ${i + 1} de ${paginas.count}`, MARGEN, doc.page.height - MARGEN, { width: ANCHO, align: "center", lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { generarReportePdf };
