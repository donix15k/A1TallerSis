const path = require("path");
const PDFDocument = require("pdfkit");
const { generarImagenQrVerificacion } = require("./verificacionFacturaService");
const { construirModeloComprobante } = require("./comprobanteModelo");

// TDSI-303: comprobante en formato de tirilla (ancho angosto, como una impresora
// termica de 80mm) para poder imprimirlo al momento o adjuntarlo en el correo.
// Rediseño Vortrix: logo arriba, tipografia monoespaciada (la misma de la vista previa
// animada del Frontend), bloque de total en azul marino y QR enmarcado.
const ANCHO_PT = 227; // ~80mm
const MARGEN = 14;
const ANCHO_QR = 84;
const ANCHO_LOGO = 150;

const ASSETS = path.join(__dirname, "..", "..", "assets");
const LOGO = path.join(ASSETS, "brand", "lockup-dark.png");
const FUENTE = path.join(ASSETS, "fonts", "JetBrainsMono-Regular.ttf");
const FUENTE_NEGRITA = path.join(ASSETS, "fonts", "JetBrainsMono-Bold.ttf");

const AZUL_MARINO = "#06152F";
const GRIS = "#616E7C";
const GRIS_CLARO = "#8A929E";
const ROJO = "#B91C1C";

const ANCHO_UTIL = ANCHO_PT - MARGEN * 2;

function registrarFuentes(doc) {
  doc.registerFont("Mono", FUENTE);
  doc.registerFont("Mono-Bold", FUENTE_NEGRITA);
}

function centrado(doc, texto, opciones = {}) {
  doc.text(texto, MARGEN, doc.y, { width: ANCHO_UTIL, align: "center", ...opciones });
}

function lineaPunteada(doc) {
  doc.moveDown(0.25);
  doc
    .save()
    .dash(1, { space: 1.6 })
    .moveTo(MARGEN, doc.y)
    .lineTo(ANCHO_PT - MARGEN, doc.y)
    .strokeColor(GRIS_CLARO)
    .lineWidth(0.6)
    .stroke()
    .restore();
  doc.moveDown(0.4);
}

function filaDosColumnas(doc, izquierda, derecha, opcionesTexto = {}) {
  const y = doc.y;
  doc.text(izquierda, MARGEN, y, { width: ANCHO_UTIL * 0.55, ...opcionesTexto });
  const yTrasIzquierda = doc.y;
  doc.text(derecha, MARGEN + ANCHO_UTIL * 0.55, y, { width: ANCHO_UTIL * 0.45, align: "right", ...opcionesTexto });
  doc.y = Math.max(doc.y, yTrasIzquierda);
  doc.moveDown(0.2);
}

/** Dibuja todo el contenido del comprobante sobre `doc`, desde el borde superior de la pagina. */
function dibujarContenido(doc, { modelo, qrBuffer }) {
  doc.y = 16;
  doc.fillColor(AZUL_MARINO);

  // --- Logo (isotipo + logotipo) y lema ---
  const altoLogo = (ANCHO_LOGO * 220) / 804;
  doc.image(LOGO, (ANCHO_PT - ANCHO_LOGO) / 2, doc.y, { width: ANCHO_LOGO });
  doc.y += altoLogo + 5;
  doc.font("Mono-Bold").fontSize(4.6).fillColor(GRIS);
  centrado(doc, "GESTIÓN DE PAGOS Y FACTURACIÓN", { characterSpacing: 0.9 });

  // --- Datos del negocio ---
  doc.moveDown(0.7);
  doc.font("Mono").fontSize(6.6).fillColor(GRIS);
  centrado(doc, modelo.empresa.direccion);
  centrado(doc, `NIT: ${modelo.empresa.nit}`);
  if (modelo.puntoVenta) centrado(doc, modelo.puntoVenta);

  // --- Titulo ---
  lineaPunteada(doc);
  doc.font("Mono-Bold").fontSize(8).fillColor(AZUL_MARINO);
  centrado(doc, modelo.titulo, { characterSpacing: 0.3 });

  if (modelo.anulada) {
    doc.moveDown(0.35);
    const ancho = 96;
    const x = (ANCHO_PT - ancho) / 2;
    const y = doc.y;
    doc.roundedRect(x, y, ancho, 15, 3).lineWidth(1).strokeColor(ROJO).stroke();
    doc.font("Mono-Bold").fontSize(8).fillColor(ROJO).text("ANULADA", x, y + 4, { width: ancho, align: "center", characterSpacing: 1.2 });
    doc.y = y + 19;
    doc.fillColor(AZUL_MARINO);
  }

  // --- Datos del comprobante ---
  lineaPunteada(doc);
  doc.font("Mono").fontSize(6.8).fillColor(AZUL_MARINO);
  modelo.datos.forEach(([etiqueta, valor]) => filaDosColumnas(doc, etiqueta, valor));
  doc.fillColor(GRIS).text(modelo.atendidoPor, MARGEN, doc.y, { width: ANCHO_UTIL });
  doc.moveDown(0.2);
  doc.fillColor(AZUL_MARINO);

  // --- Cliente ---
  lineaPunteada(doc);
  modelo.cliente.forEach(([etiqueta, valor]) => filaDosColumnas(doc, etiqueta, valor));

  // --- Detalle ---
  lineaPunteada(doc);
  doc.font("Mono-Bold").fontSize(6.8);
  filaDosColumnas(doc, modelo.detalle.encabezado[0], modelo.detalle.encabezado[1]);
  doc.font("Mono").fontSize(6.8);
  modelo.detalle.filas.forEach(([etiqueta, monto]) => filaDosColumnas(doc, etiqueta, monto));

  // --- Total: bloque azul marino ---
  doc.moveDown(0.5);
  const yTotal = doc.y;
  doc.roundedRect(MARGEN, yTotal, ANCHO_UTIL, 24, 4).fill(AZUL_MARINO);
  doc.fillColor("#FFFFFF").font("Mono-Bold").fontSize(8);
  doc.text("TOTAL Bs.", MARGEN + 8, yTotal + 8, { width: ANCHO_UTIL / 2 - 8, lineBreak: false });
  doc.fontSize(12).text(modelo.total, MARGEN + ANCHO_UTIL / 2, yTotal + 6, { width: ANCHO_UTIL / 2 - 8, align: "right", lineBreak: false });
  doc.y = yTotal + 24 + 6;

  doc.fillColor(GRIS).font("Mono").fontSize(6.4);
  doc.text(modelo.son, MARGEN, doc.y, { width: ANCHO_UTIL });

  // --- QR ---
  doc.moveDown(0.5);
  lineaPunteada(doc);
  const yQr = doc.y + 2;
  const marco = ANCHO_QR + 12;
  doc.roundedRect(ANCHO_PT / 2 - marco / 2, yQr, marco, marco, 6).lineWidth(0.8).strokeColor("#C5CBD4").stroke();
  doc.image(qrBuffer, ANCHO_PT / 2 - ANCHO_QR / 2, yQr + 6, { width: ANCHO_QR, height: ANCHO_QR });
  doc.y = yQr + marco + 7; // doc.image no mueve el cursor solo: hay que avanzarlo a mano.

  doc.font("Mono").fontSize(5.8).fillColor(GRIS);
  centrado(doc, modelo.qrTexto);

  // --- Pie ---
  doc.moveDown(0.7);
  doc.fontSize(5.6).fillColor(GRIS_CLARO);
  modelo.pie.forEach((linea) => centrado(doc, linea));
  doc.moveDown(0.5);
  doc.font("Mono-Bold").fontSize(7.4).fillColor(AZUL_MARINO);
  centrado(doc, modelo.gracias);
  doc.moveDown(1);
}

/** Genera el PDF de la factura/comprobante como Buffer, listo para adjuntar en un correo o servir para imprimir. */
async function generarFacturaPdfBuffer(factura) {
  const modelo = construirModeloComprobante(factura);
  // TDSI-38/529: el QR ahora lleva a la URL publica de verificacion (TDSI-527/528),
  // no a un texto suelto -- al escanearlo, el cliente ve su factura de verdad.
  const qrBuffer = await generarImagenQrVerificacion(factura.comprobante.tokenVerificacion, { ancho: ANCHO_QR * 2 });
  const contexto = { modelo, qrBuffer };

  // La altura de la tirilla depende de cuantos metodos de pago tenga la venta, asi que
  // primero se "dibuja" en un documento descartable de sobra para medir cuanto ocupa,
  // y recien despues se genera el PDF real con el alto exacto (sin espacio en blanco).
  const docMedida = new PDFDocument({ size: [ANCHO_PT, 2000], margin: 0 });
  registrarFuentes(docMedida);
  docMedida.on("data", () => {});
  dibujarContenido(docMedida, contexto);
  const alturaTotal = Math.ceil(docMedida.y) + 6;
  docMedida.end();

  const doc = new PDFDocument({
    size: [ANCHO_PT, alturaTotal],
    margin: 0,
    info: { Title: `Comprobante ${factura.comprobante.id_transaccion}`, Author: "Vortrix" },
  });
  registrarFuentes(doc);
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const listo = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  dibujarContenido(doc, contexto);
  doc.end();
  return listo;
}

module.exports = { generarFacturaPdfBuffer };
