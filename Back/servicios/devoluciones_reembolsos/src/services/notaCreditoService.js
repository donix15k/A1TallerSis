const path = require("path");
const PDFDocument = require("pdfkit");
const devolucionService = require("./devolucionService");
const facturacionProxy = require("./facturacionProxy");
const notasCreditoRepo = require("../data/notasCreditoRepo");
const { query } = require("../config/db");
const { montoEnLetras } = require("../utils/numeroALetras");
const { AppError } = require("../utils/AppError");

// Datos de la empresa que emite la nota (los mismos del comprobante de Gestion de Pagos; se pueden cambiar por entorno).
const empresa = () => ({
  nombre: process.env.EMPRESA_NOMBRE || "Vortrix",
  direccion: process.env.EMPRESA_DIRECCION || "Av. Principal s/n, Bolivia",
  nit: process.env.EMPRESA_NIT || "1009876015",
});

const ASSETS = path.join(__dirname, "..", "..", "assets");
const LOGO = path.join(ASSETS, "brand", "lockup-dark.png");
const FUENTE = path.join(ASSETS, "fonts", "JetBrainsMono-Regular.ttf");
const FUENTE_NEGRITA = path.join(ASSETS, "fonts", "JetBrainsMono-Bold.ttf");
const AZUL = "#06152F";
const GRIS = "#616E7C";

const bs = (n) => `Bs ${Number(n).toFixed(2)}`;
const fechaBolivia = (f) =>
  new Date(f).toLocaleString("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * TDSI-58: junta todo lo que lleva la nota de credito de una devolucion PROCESADA: la nota (numero, monto, fecha),
 * la devolucion (productos devueltos), la factura original (numero, fecha, cliente) y los datos de la empresa.
 * 409 si la devolucion todavia no esta PROCESADA (la nota se emite al reembolsar); 404 si no existe.
 */
async function armarNota(codigo) {
  const devolucion = await devolucionService.obtenerDevolucion(codigo); // 404 si no existe
  const { rows } = await query(`SELECT id FROM devoluciones.devoluciones WHERE codigo = $1`, [devolucion.codigo]);
  const nota = await notasCreditoRepo.obtenerPorDevolucion(Number(rows[0].id));
  if (!nota) {
    throw new AppError(
      `La devolución ${devolucion.codigo} está ${devolucion.estado} y todavía no tiene nota de crédito: se emite al reembolsar.`,
      409,
      { codigo: devolucion.codigo, estado: devolucion.estado }
    );
  }
  const factura = await facturacionProxy.obtenerFactura(devolucion.factura_numero);
  return { devolucion, nota, factura, empresa: empresa() };
}

/** Dibuja la nota en una hoja A4. */
function dibujar(doc, { devolucion, nota, factura, empresa: emp }) {
  doc.registerFont("Mono", FUENTE);
  doc.registerFont("Mono-Bold", FUENTE_NEGRITA);
  const M = 48;
  const ancho = doc.page.width - M * 2;

  doc.image(LOGO, M, 40, { width: 170 });
  doc.font("Mono-Bold").fontSize(16).fillColor(AZUL).text("NOTA DE CRÉDITO", M, 44, { width: ancho, align: "right" });
  doc.font("Mono-Bold").fontSize(12).text(nota.numero, M, 66, { width: ancho, align: "right" });
  doc.font("Mono").fontSize(8).fillColor(GRIS).text(`Fecha de emisión: ${fechaBolivia(nota.emitida_en)}`, M, 84, { width: ancho, align: "right" });

  let y = 120;
  doc.font("Mono-Bold").fontSize(9).fillColor(AZUL).text(emp.nombre, M, y);
  doc.font("Mono").fontSize(8).fillColor(GRIS).text(emp.direccion, M, y + 13).text(`NIT: ${emp.nit}`, M, y + 25);

  y += 52;
  doc.moveTo(M, y).lineTo(M + ancho, y).strokeColor("#D5DAE1").lineWidth(0.8).stroke();
  y += 10;
  const datos = [
    ["Factura original", factura.numero],
    ["Fecha de la factura", fechaBolivia(factura.fecha)],
    ["Cliente", factura.cliente_nombre || "Sin nombre"],
    ["NIT / CI", factura.cliente_nit || "0"],
    ["Devolución", devolucion.codigo],
    ["Motivo", devolucion.motivo?.nombre || "-"],
  ];
  doc.fontSize(8.5);
  for (const [k, v] of datos) {
    doc.font("Mono").fillColor(GRIS).text(k, M, y, { width: 150 });
    doc.font("Mono-Bold").fillColor(AZUL).text(String(v), M + 150, y, { width: ancho - 150 });
    y += 15;
  }

  y += 10;
  doc.rect(M, y, ancho, 20).fill(AZUL);
  doc.font("Mono-Bold").fontSize(8.5).fillColor("#FFFFFF");
  doc.text("Producto devuelto", M + 8, y + 6, { width: ancho * 0.5 });
  doc.text("Cant.", M + ancho * 0.5, y + 6, { width: ancho * 0.12, align: "right" });
  doc.text("P. unit.", M + ancho * 0.62, y + 6, { width: ancho * 0.18, align: "right" });
  doc.text("Subtotal", M + ancho * 0.8 - 8, y + 6, { width: ancho * 0.2, align: "right" });
  y += 26;
  for (const it of devolucion.items) {
    doc.font("Mono").fontSize(8.5).fillColor(AZUL);
    doc.text(it.descripcion, M + 8, y, { width: ancho * 0.5 - 8 });
    const alto = doc.y - y;
    doc.text(String(it.cantidad), M + ancho * 0.5, y, { width: ancho * 0.12, align: "right" });
    doc.text(it.precio_unitario.toFixed(2), M + ancho * 0.62, y, { width: ancho * 0.18, align: "right" });
    doc.text(it.subtotal.toFixed(2), M + ancho * 0.8 - 8, y, { width: ancho * 0.2, align: "right" });
    y += Math.max(alto, 12) + 6;
    if (y > doc.page.height - 160) {
      doc.addPage();
      y = 48;
    }
  }

  doc.moveTo(M, y).lineTo(M + ancho, y).strokeColor("#D5DAE1").lineWidth(0.8).stroke();
  y += 10;
  doc.font("Mono-Bold").fontSize(12).fillColor(AZUL).text(`TOTAL ACREDITADO: ${bs(nota.monto)}`, M, y, { width: ancho, align: "right" });
  y += 24;
  doc.font("Mono").fontSize(8.5).fillColor(GRIS).text(`Son: ${montoEnLetras(nota.monto)}`, M, y, { width: ancho, align: "right" });
  y += 40;
  doc.font("Mono").fontSize(7.5).fillColor(GRIS).text(
    "Este documento respalda la devolución de la venta indicada y reduce su valor facturado. No es válido como comprobante de venta.",
    M, y, { width: ancho }
  );
}

/** TDSI-58: el PDF de la nota de credito (Buffer). */
async function generarPdf(codigo) {
  const datos = await armarNota(codigo);
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Nota de crédito ${datos.nota.numero}`, Author: datos.empresa.nombre } });
  const trozos = [];
  doc.on("data", (c) => trozos.push(c));
  const fin = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(trozos)));
    doc.on("error", reject);
  });
  dibujar(doc, datos);
  doc.end();
  return fin;
}

module.exports = { armarNota, generarPdf, dibujar };
