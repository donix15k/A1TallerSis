const ExcelJS = require("exceljs");
const devolucionService = require("./devolucionService");

const MAX_FILAS_EXPORTAR = 10000;

const fechaBolivia = (f) =>
  new Date(f).toLocaleString("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * TDSI-81: arma el Excel con el listado de devoluciones, con LOS MISMOS filtros que la tabla del administrador
 * (desde, hasta, estado, cajero) pero sin paginar: baja todo lo que se esta viendo (hasta 10.000 filas).
 * Devuelve { buffer, total, filas, truncado }.
 */
async function exportarDevoluciones(filtros = {}) {
  const { total, filas } = await devolucionService.listarParaExportar(filtros, MAX_FILAS_EXPORTAR);

  const libro = new ExcelJS.Workbook();
  libro.creator = "Vortrix";
  const hoja = libro.addWorksheet("Devoluciones");
  hoja.columns = [
    { header: "Código", key: "codigo", width: 12 },
    { header: "Factura", key: "factura_numero", width: 14 },
    { header: "Cajero", key: "cajero", width: 34 },
    { header: "Tipo", key: "tipo", width: 10 },
    { header: "Motivo", key: "motivo", width: 24 },
    { header: "Monto (Bs)", key: "monto_total", width: 13, style: { numFmt: "#,##0.00" } },
    { header: "Estado", key: "estado", width: 12 },
    { header: "Fecha (Bolivia)", key: "fecha", width: 18 },
    { header: "Requiere autorización", key: "requiere_autorizacion", width: 22 },
  ];
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: "frozen", ySplit: 1 }];

  for (const f of filas) {
    hoja.addRow({
      codigo: f.codigo,
      factura_numero: f.factura_numero,
      cajero: f.cajero,
      tipo: f.tipo,
      motivo: f.motivo ? f.motivo.nombre : "",
      monto_total: f.monto_total,
      estado: f.estado,
      fecha: fechaBolivia(f.fecha_solicitud),
      requiere_autorizacion: f.requiere_autorizacion ? "Sí" : "No",
    });
  }
  const totalMonto = filas.reduce((a, f) => a + Math.round(f.monto_total * 100), 0) / 100;
  const pie = hoja.addRow({ cajero: `Total (${filas.length} devoluciones)`, monto_total: totalMonto });
  pie.font = { bold: true };

  return { buffer: Buffer.from(await libro.xlsx.writeBuffer()), total, filas: filas.length, truncado: total > filas.length };
}

module.exports = { exportarDevoluciones, MAX_FILAS_EXPORTAR };
