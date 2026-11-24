const path = require("path");
const PDFDocument = require("pdfkit");

const LOGO = path.join(__dirname, "..", "..", "assets", "brand", "lockup-dark.png");

const M = 44; // margen
const W = 595.28; // A4 en puntos
const H = 841.89;
const ANCHO = W - M * 2;
const PIE = 46; // espacio reservado abajo para el pie de pagina

// Paleta de la marca Vortrix
const AZUL = "#06152F";
const AZUL_SUAVE = "#E8EEF8";
const GRIS = "#616E7C";
const LINEA = "#D5DCE6";
const ZEBRA = "#F5F8FC";
const VERDE = "#0F7B4F";
const VERDE_FONDO = "#DDF3E8";
const AMBAR = "#92400E";
const AMBAR_FONDO = "#FDEFD2";
const ROJO = "#B42318";

const empresa = () => ({
  nombre: process.env.EMPRESA_NOMBRE || "Vortrix",
  direccion: process.env.EMPRESA_DIRECCION || "Av. Principal s/n, Bolivia",
  nit: process.env.EMPRESA_NIT || "1009876015",
});

const bs = (n) => `Bs ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (f) =>
  f
    ? new Date(f).toLocaleString("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "-";
const hora = (f) => new Date(f).toLocaleTimeString("es-BO", { timeZone: "America/La_Paz", hour: "2-digit", minute: "2-digit", hour12: false });

/** Si lo que sigue no cabe en la hoja, salta a una nueva (el pie se dibuja al final en cada pagina). */
function espacio(doc, alto) {
  if (doc.y + alto > H - PIE - 10) {
    doc.addPage();
    doc.y = M;
  }
}

/** Titulo de seccion: barra azul a la izquierda y texto en mayusculas. */
function seccion(doc, texto) {
  espacio(doc, 120); // el titulo nunca queda solo al final de la hoja
  doc.y += 14;
  const y = doc.y;
  doc.rect(M, y, 4, 16).fill(AZUL);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(AZUL).text(texto.toUpperCase(), M + 12, y + 3, { width: ANCHO - 12, characterSpacing: 0.6 });
  doc.y = y + 26;
}

/** Tabla: columnas con ancho relativo y alineacion; cabecera azul y filas cebra. */
function tabla(doc, columnas, filas, { pie = null, negritaUltima = false } = {}) {
  const suma = columnas.reduce((a, c) => a + c.ancho, 0);
  const anchos = columnas.map((c) => (c.ancho / suma) * ANCHO);
  const alto = 22;

  const celdas = (y, valores, { fuente = "Helvetica", color = "#1F2933", tam = 9.5 } = {}) => {
    let x = M;
    valores.forEach((v, i) => {
      doc.font(fuente).fontSize(tam).fillColor(color).text(String(v), x + 8, y + 6.5, { width: anchos[i] - 16, align: columnas[i].alinea || "left", lineBreak: false });
      x += anchos[i];
    });
  };

  const cabecera = () => {
    const y = doc.y;
    doc.rect(M, y, ANCHO, alto).fill(AZUL);
    celdas(y, columnas.map((c) => c.titulo), { fuente: "Helvetica-Bold", color: "#FFFFFF", tam: 9 });
    doc.y = y + alto;
  };

  espacio(doc, alto * 2 + 6);
  cabecera();
  filas.forEach((f, i) => {
    if (doc.y + alto > H - PIE - 10) {
      doc.addPage();
      doc.y = M;
      cabecera();
    }
    const y = doc.y;
    if (i % 2 === 1) doc.rect(M, y, ANCHO, alto).fill(ZEBRA);
    const ultima = negritaUltima && i === filas.length - 1;
    celdas(y, f, { fuente: ultima ? "Helvetica-Bold" : "Helvetica" });
    doc.y = y + alto;
  });
  if (pie) {
    espacio(doc, alto + 4);
    const y = doc.y;
    doc.rect(M, y, ANCHO, alto).fill(AZUL_SUAVE);
    celdas(y, pie, { fuente: "Helvetica-Bold", color: AZUL, tam: 10 });
    doc.y = y + alto;
  }
  doc.moveTo(M, doc.y).lineTo(M + ANCHO, doc.y).lineWidth(0.8).strokeColor(LINEA).stroke();
  doc.y += 4;
}

/** Cuadro de datos clave/valor en dos columnas. */
function datos(doc, pares) {
  const filas = Math.ceil(pares.length / 2);
  const alto = filas * 30 + 14;
  espacio(doc, alto);
  const y0 = doc.y;
  doc.roundedRect(M, y0, ANCHO, alto, 6).fillAndStroke(ZEBRA, LINEA);
  pares.forEach(([k, v], i) => {
    const col = i % 2;
    const fila = Math.floor(i / 2);
    const x = M + 16 + col * (ANCHO / 2);
    const y = y0 + 10 + fila * 30;
    doc.font("Helvetica").fontSize(8).fillColor(GRIS).text(k.toUpperCase(), x, y, { width: ANCHO / 2 - 24, characterSpacing: 0.5, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(AZUL).text(String(v), x, y + 11, { width: ANCHO / 2 - 24, lineBreak: false, ellipsis: true });
  });
  doc.y = y0 + alto;
}

/** Tarjeta destacada (total recaudado, etc.). */
function tarjeta(doc, x, y, ancho, titulo, valor, { fondo = AZUL, texto = "#FFFFFF", sub = "#B7C5DD" } = {}) {
  doc.roundedRect(x, y, ancho, 62, 8).fill(fondo);
  doc.font("Helvetica").fontSize(8).fillColor(sub).text(titulo.toUpperCase(), x + 14, y + 12, { width: ancho - 28, characterSpacing: 0.5, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(19).fillColor(texto).text(valor, x + 14, y + 29, { width: ancho - 28, lineBreak: false });
}

/**
 * Devoluciones reembolsadas durante el turno: por cada una, fecha y hora, codigo, factura, monto, como se devolvio el dinero (efectivo, tarjeta o
 * vale) y los productos devueltos. Al final, cuanto se devolvio en total por cada forma.
 */
function bloqueDevoluciones(doc, devoluciones) {
  seccion(doc, "Devoluciones del turno");
  if (devoluciones === null) {
    doc.font("Helvetica").fontSize(9.5).fillColor(AMBAR).text("No se pudieron consultar las devoluciones de este turno (el servicio de Devoluciones no respondió).", M, doc.y, { width: ANCHO });
    doc.y += 6;
    return;
  }
  const totales = new Map();
  for (const d of devoluciones) {
    const alto = 40 + d.productos.length * 14;
    espacio(doc, alto);
    const y = doc.y;
    doc.rect(M, y, ANCHO, 22).fill(AZUL);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#FFFFFF");
    doc.text(`${fecha(d.procesada_en)}  ·  ${d.codigo}  ·  Factura ${d.factura_numero}`, M + 8, y + 6.5, { width: ANCHO * 0.68, lineBreak: false });
    doc.text(bs(d.monto_total), M + ANCHO * 0.68, y + 6.5, { width: ANCHO * 0.32 - 8, align: "right", lineBreak: false });
    let yy = y + 22;
    for (const p of d.productos) {
      doc.font("Helvetica").fontSize(9.5).fillColor("#1F2933");
      doc.text(`${p.cantidad} x ${p.descripcion}`, M + 8, yy + 3, { width: ANCHO * 0.75, lineBreak: false, ellipsis: true });
      doc.text(bs(p.subtotal), M + ANCHO * 0.75, yy + 3, { width: ANCHO * 0.25 - 8, align: "right", lineBreak: false });
      yy += 14;
    }
    doc.rect(M, yy + 2, ANCHO, 18).fill(AZUL_SUAVE);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(AZUL);
    doc.text(`Devuelto en: ${d.reembolsos.map((r) => `${r.forma} ${bs(r.monto)}`).join("  +  ")}`, M + 8, yy + 7, { width: ANCHO - 16, lineBreak: false });
    for (const r of d.reembolsos) totales.set(r.forma, Math.round(((totales.get(r.forma) ?? 0) + r.monto) * 100) / 100);
    doc.y = yy + 28;
  }
  if (devoluciones.length === 0) {
    doc.font("Helvetica").fontSize(9.5).fillColor(GRIS).text("No hubo devoluciones en este turno.", M, doc.y, { width: ANCHO });
    doc.y += 8;
    return;
  }
  espacio(doc, 30);
  const yT = doc.y + 2;
  doc.roundedRect(M, yT, ANCHO, 24, 6).fill(AZUL_SUAVE);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(AZUL);
  doc.text(`Total devuelto: ${devoluciones.length} ${devoluciones.length === 1 ? "devolución" : "devoluciones"}  ·  ${[...totales.entries()].map(([f, m]) => `${f} ${bs(m)}`).join("  ·  ")}`, M + 10, yT + 7.5, { width: ANCHO - 20, lineBreak: false });
  doc.y = yT + 30;
}

/** TDSI-324: PDF del reporte de cierre de caja, con la firma del cajero al final. */
function generarReporteCierrePdfBuffer(reporte, { cajeroNombre, cajeroUsuario }) {
  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: `Cierre de caja ${reporte.codigo}`, Author: empresa().nombre } });

  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const listo = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const emp = empresa();
  const cajero = cajeroNombre || cajeroUsuario || "-";

  // ---- Encabezado: logo a la izquierda, titulo y turno a la derecha
  doc.image(LOGO, M, M - 4, { width: 150 });
  doc.font("Helvetica-Bold").fontSize(15).fillColor(AZUL).text("REPORTE DE CIERRE DE CAJA", M, M, { width: ANCHO, align: "right", lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(12).fillColor(GRIS).text(reporte.codigo, M, M + 22, { width: ANCHO, align: "right", lineBreak: false });
  doc.font("Helvetica").fontSize(8.5).fillColor(GRIS).text(`${emp.nombre} · NIT ${emp.nit} · ${emp.direccion}`, M, M + 40, { width: ANCHO, align: "right", lineBreak: false });
  const yLinea = M + 62;
  doc.rect(M, yLinea, ANCHO, 3).fill(AZUL);
  doc.y = yLinea + 16;

  // ---- Datos del turno
  const pares = [
    ["Turno", reporte.codigo],
    ["Caja", reporte.cajaId],
    ["Cajero", cajero],
    ["Cierre autorizado por", reporte.cerradoPorNombre || "-"],
    ["Apertura", fecha(reporte.abiertoEn)],
    ["Cierre", fecha(reporte.cerradoEn)],
  ];
  datos(doc, pares);

  // ---- Totales destacados
  doc.y += 14;
  espacio(doc, 70);
  const yT = doc.y;
  const gap = 12;
  const aw = (ANCHO - gap * 2) / 3;
  const dif = reporte.arqueoEfectivo;
  tarjeta(doc, M, yT, aw, "Total recaudado", bs(reporte.totalRecaudado));
  tarjeta(doc, M + aw + gap, yT, aw, "Ventas realizadas", String(reporte.resumenVentas.cantidadVentas), { fondo: AZUL_SUAVE, texto: AZUL, sub: GRIS });
  if (dif) {
    const cuadra = dif.tipoDiferencia === "CUADRA";
    tarjeta(doc, M + (aw + gap) * 2, yT, aw, `Arqueo: ${dif.tipoDiferencia}`, bs(dif.diferencia), cuadra ? { fondo: VERDE_FONDO, texto: VERDE, sub: VERDE } : { fondo: AMBAR_FONDO, texto: AMBAR, sub: AMBAR });
  } else {
    tarjeta(doc, M + (aw + gap) * 2, yT, aw, "Facturas anuladas", String(reporte.resumenVentas.cantidadAnuladas), { fondo: AZUL_SUAVE, texto: AZUL, sub: GRIS });
  }
  doc.y = yT + 62;

  // ---- Ventas por metodo de pago
  seccion(doc, "Ventas por método de pago");
  const m = reporte.totalesPorMetodo;
  tabla(
    doc,
    [
      { titulo: "Método", ancho: 3 },
      { titulo: "Operaciones", ancho: 2, alinea: "right" },
      { titulo: "Monto", ancho: 2.5, alinea: "right" },
    ],
    [
      ["Efectivo", m.Efectivo.operaciones, bs(m.Efectivo.neto)],
      ["Tarjeta", m.Tarjeta.operaciones, bs(m.Tarjeta.neto)],
      ["QR", m.QR.operaciones, bs(m.QR.neto)],
    ],
    { pie: ["Total recaudado", m.Efectivo.operaciones + m.Tarjeta.operaciones + m.QR.operaciones, bs(reporte.totalRecaudado)] }
  );
  doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(`Del total, ${bs(reporte.resumenVentas.totalDigital)} se cobró en digital (tarjeta + QR).`, M, doc.y + 2, { width: ANCHO });

  // ---- Resumen de ventas
  seccion(doc, "Resumen de ventas");
  const resumen = [["Cantidad de ventas", reporte.resumenVentas.cantidadVentas], ["Facturas anuladas", reporte.resumenVentas.cantidadAnuladas]];
  if (reporte.resumenVentas.cantidadAnuladas > 0) resumen.push(["Monto anulado (no contado)", bs(reporte.resumenVentas.montoAnulado)]);
  tabla(doc, [{ titulo: "Concepto", ancho: 4 }, { titulo: "Valor", ancho: 2.5, alinea: "right" }], resumen);

  // ---- TDSI-931: detalle de cada factura anulada
  if (reporte.anuladas && reporte.anuladas.length > 0) {
    seccion(doc, "Facturas anuladas");
    tabla(
      doc,
      [
        { titulo: "Factura", ancho: 2.2 },
        { titulo: "Hora", ancho: 1.1 },
        { titulo: "Total", ancho: 1.8, alinea: "right" },
        { titulo: "Motivo", ancho: 3.6 },
        { titulo: "Autorizó", ancho: 2.2 },
      ],
      reporte.anuladas.map((f) => [f.numero_factura, hora(f.hora), bs(f.total), f.motivo || "-", f.supervisor || "-"])
    );
  }

  // ---- Devoluciones reembolsadas en el turno
  if (reporte.devoluciones !== undefined) bloqueDevoluciones(doc, reporte.devoluciones);

  // ---- Arqueo de efectivo
  if (dif) {
    seccion(doc, "Arqueo de efectivo");
    tabla(
      doc,
      [{ titulo: "Concepto", ancho: 4 }, { titulo: "Monto", ancho: 2.5, alinea: "right" }],
      [
        ["Efectivo inicial", bs(dif.efectivoInicial)],
        ["Ventas en efectivo", bs(dif.ventasEfectivo)],
        ["Egresos en efectivo", bs(dif.egresosEfectivo)],
        ["Efectivo esperado", bs(dif.efectivoEsperado)],
        ["Efectivo contado", bs(dif.efectivoContado)],
      ]
    );
    // Resultado del arqueo como una franja de color: verde si cuadra, ambar si sobra o falta
    espacio(doc, 40);
    const cuadra = dif.tipoDiferencia === "CUADRA";
    const yR = doc.y + 6;
    doc.roundedRect(M, yR, ANCHO, 28, 6).fill(cuadra ? VERDE_FONDO : AMBAR_FONDO);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(cuadra ? VERDE : AMBAR);
    doc.text(cuadra ? "LA CAJA CUADRA" : dif.tipoDiferencia, M + 14, yR + 8.5, { width: ANCHO / 2, lineBreak: false });
    doc.text(bs(dif.diferencia), M + ANCHO / 2, yR + 8.5, { width: ANCHO / 2 - 14, align: "right", lineBreak: false });
    doc.y = yR + 34;
  }

  // ---- TDSI-880: detalle de billetes y monedas contados en el arqueo
  if (reporte.arqueoDenominaciones) {
    seccion(doc, "Detalle del conteo (billetes y monedas)");
    tabla(
      doc,
      [
        { titulo: "Tipo", ancho: 2 },
        { titulo: "Denominación", ancho: 2.5, alinea: "right" },
        { titulo: "Cantidad", ancho: 1.8, alinea: "right" },
        { titulo: "Subtotal", ancho: 2.5, alinea: "right" },
      ],
      reporte.arqueoDenominaciones.detalle.map((d) => [d.tipo === "BILLETE" ? "Billete" : "Moneda", bs(d.denominacion), d.cantidad, bs(d.subtotal)]),
      { pie: ["Total contado", "", "", bs(reporte.arqueoDenominaciones.totalContado)] }
    );
  }

  // ---- Firma del cajero
  espacio(doc, 130);
  const yF = doc.y + 56;
  const anchoFirma = 230;
  const xFirma = M + (ANCHO - anchoFirma) / 2;
  doc.moveTo(xFirma, yF).lineTo(xFirma + anchoFirma, yF).lineWidth(0.8).strokeColor(AZUL).stroke();
  doc.font("Helvetica-Bold").fontSize(10).fillColor(AZUL).text("Firma del cajero", M, yF + 6, { width: ANCHO, align: "center", lineBreak: false });
  doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(cajero, M, yF + 21, { width: ANCHO, align: "center", lineBreak: false });
  if (cajeroUsuario && cajeroNombre && cajeroUsuario !== cajeroNombre) {
    doc.text(cajeroUsuario, M, yF + 34, { width: ANCHO, align: "center", lineBreak: false });
  }

  // ---- Pie de pagina en todas las hojas
  const rango = doc.bufferedPageRange();
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // evita que pdfkit agregue una hoja al escribir en la franja del pie
    const y = H - PIE + 8;
    doc.moveTo(M, y).lineTo(M + ANCHO, y).lineWidth(0.6).strokeColor(LINEA).stroke();
    doc.font("Helvetica").fontSize(8).fillColor(GRIS);
    doc.text(`${emp.nombre} · Reporte de cierre de caja ${reporte.codigo} · Generado el ${fecha(new Date())}`, M, y + 8, { width: ANCHO - 80, lineBreak: false });
    doc.text(`Página ${i - rango.start + 1} de ${rango.count}`, M + ANCHO - 80, y + 8, { width: 80, align: "right", lineBreak: false });
  }

  doc.end();
  return listo;
}

module.exports = { generarReporteCierrePdfBuffer };
