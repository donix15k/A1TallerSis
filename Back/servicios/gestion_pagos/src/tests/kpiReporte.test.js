// TDSI-209/210/211/212: GET /api/kpis/exportar.pdf y exportar.xlsx. BD real: ventas de prueba insertadas DIRECTO en un mes lejano (marzo de
// 2011) y borradas al terminar; Caja, Facturacion, Pagos a Proveedores y Devoluciones son UN servidor HTTP local; el Monitor de
// integraciones usa fuentes falsas. Nunca se publica nada a ningun grupo.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const ExcelJS = require("exceljs");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/kpiRoutes");
const { usarFuentesDePrueba } = require("../services/integraciones/fuentes");
const { construirReporte, validarSecciones, periodoDelReporte } = require("../services/kpiReporteService");
const { generarReportePdf } = require("../services/kpiReportePdfService");
const { generarReporteExcel } = require("../services/kpiReporteExcelService");

let externo, servidor, base;
let r; // lo que responde cada servicio (objeto de datos o "caida")

const venta = (id, monto, estado = "Registrado") =>
  query(`INSERT INTO pagos.transacciones (id_transaccion, metodo, monto, tipo_pago, estado, fecha) VALUES ($1, 'Efectivo', $2, 'Simple', $3, '2011-03-10 10:00:00-04'::timestamptz)`, [id, monto, estado]);

const datosBase = () => ({
  metas: {
    general: { porcentaje: 86, color: "AMARILLO", vendido: 25100, meta: 30000, cajas_con_meta: 3 },
    cajas: [
      { caja_id: "CAJA-01", caja_nombre: "Caja 1", vendido: 10700, meta: 10000, porcentaje: 107, color: "VERDE", meta_origen: "mensual" },
      { caja_id: "CAJA-02", caja_nombre: "Caja 2", vendido: 8300, meta: 10000, porcentaje: 83, color: "AMARILLO", meta_origen: "mensual" },
      { caja_id: "CAJA-03", caja_nombre: "Caja 3", vendido: 6100, meta: 10000, porcentaje: 61, color: "ROJO", meta_origen: "diaria_por_dias" },
    ],
    umbrales: { verde: 100, amarillo: 70 },
  },
  cuadre: {
    turnos_cerrados: 46, turnos_cuadran: 38, porcentaje: 82.6, color: "ROJO", sobrantes: 64.5, faltantes: 187.3,
    turnos_con_diferencia: [{ turno: "TUR-000045", caja_nombre: "Caja 3", cajero: "Sofía T.", diferencia: -22, tipo: "FALTANTE" }],
    ultimos_turnos: [],
  },
  aceptacion: {
    enviados: 1118, registrados: 1104, rechazados: 14, sin_respuesta: 0, porcentaje: 98.7, color: "VERDE", incompleto: false, rechazados_total: 14,
    rechazados_lista: [{ origen: "facturacion", id: "5", referencia: "F-010482", tipo: "FACTURA_VENTA", motivo: "cuenta contable inexistente", enviado_en: "2011-03-12T14:00:00.000Z" }],
  },
  proveedores: {
    valor: 5.8, color: "VERDE", ordenes_recibidas: 42, ultima_orden_recibida_en: "2011-03-20T12:00:00.000Z", ordenes_pagadas_total: 7, ordenes_vencidas_total: 1,
    ordenes_vencidas: [{ orden: "OP-2026-0131", proveedor: "Distribuidora Andina", monto: 3450, dias: 18.4, estado: "VENCIDA" }],
    ordenes_pagadas: [{ orden: "OP-2026-0140", proveedor: "Insumos del Sur", monto: 500, dias: 6, estado: "PAGADA" }],
  },
  devoluciones: { monto_devuelto: 12, cantidad: 1, motivos: [] },
});

/** Texto de un PDF generado sin comprimir: junta los trozos hex (WinAnsi) de cada TJ. */
function textoDelPdf(buffer) {
  const s = buffer.toString("latin1");
  const lineas = [];
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    lineas.push([...m[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => new TextDecoder("windows-1252").decode(Buffer.from(h[1], "hex"))).join(""));
  }
  return lineas.join("\n");
}

test.before(async () => {
  await query(`DELETE FROM pagos.transacciones WHERE id_transaccion LIKE 'KPI209-%'`);
  externo = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const token = req.headers.authorization || "";
    if (req.url.startsWith("/api/administradores/verificar")) {
      if (token === "Bearer ADMIN") return res.end(JSON.stringify({ ok: true, data: { administrador_id: "A" } }));
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok: false, mensaje: "no" }));
    }
    const clave = { "/api/kpis/cumplimiento-metas": "metas", "/api/kpis/cuadre-caja": "cuadre", "/api/kpis/aceptacion-contable": "aceptacion", "/api/kpis/dias-pago-proveedores": "proveedores", "/api/kpis/devoluciones": "devoluciones" }[req.url.split("?")[0]];
    if (!clave) { res.statusCode = 404; return res.end("{}"); }
    if (r[clave] === "caida") { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, mensaje: `boom ${clave}` })); }
    res.end(JSON.stringify({ ok: true, data: r[clave] }));
  });
  await new Promise((ok) => externo.listen(0, ok));
  const url = `http://localhost:${externo.address().port}`;
  Object.assign(process.env, { ADMIN_VERIFICAR_URL: url, GESTION_CAJA_URL: url, FACTURACION_URL: url, PAGOS_PROVEEDORES_URL: url, DEVOLUCIONES_URL: url, GESTION_PAGOS_URL: "http://localhost:1" });
  usarFuentesDePrueba([{ origen: "falsa", listar: async () => [], reenviar: async () => {} }]);

  // marzo de 2011: 20 ventas validas de Bs 40 (ticket 40 = AMARILLO) y 1 anulada (1 de 21 = 4,76 % = AMARILLO)
  for (let i = 0; i < 20; i++) await venta(`KPI209-V${i}`, 40);
  await venta("KPI209-A", 40, "Anulado");

  const app = express();
  app.use("/api/kpis", rutas);
  app.use(errorHandler);
  servidor = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis`;
});
test.beforeEach(() => { r = datosBase(); });
test.after(async () => {
  usarFuentesDePrueba(null);
  for (const k of ["ADMIN_VERIFICAR_URL", "GESTION_CAJA_URL", "FACTURACION_URL", "PAGOS_PROVEEDORES_URL", "DEVOLUCIONES_URL", "GESTION_PAGOS_URL"]) delete process.env[k];
  servidor.close();
  externo.close();
  await query(`DELETE FROM pagos.transacciones WHERE id_transaccion LIKE 'KPI209-%'`);
  await pool.end();
});

const pedir = (ruta, qs, token = "ADMIN") => fetch(`${base}/${ruta}${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const TODAS = "secciones=resumen,cajas,integraciones";
const leerExcel = async (res) => { const libro = new ExcelJS.Workbook(); await libro.xlsx.load(Buffer.from(await res.arrayBuffer())); return libro; };

// ---------------------------------------------------------------- validacion
test("las secciones: al menos una, solo las 3 conocidas, siempre en el orden del reporte", () => {
  assert.deepEqual(validarSecciones("integraciones,resumen"), ["resumen", "integraciones"]);
  assert.deepEqual(validarSecciones(" Cajas , cajas "), ["cajas"]);
  for (const mala of [undefined, "", " , ", "resumen,otra"]) assert.throws(() => validarSecciones(mala), (e) => e.status === 400, String(mala));
});

test("el periodo: un mes COMPLETO (dia 1 al ultimo) o ?periodo; medio mes, dos meses o fechas falsas son 400", () => {
  assert.equal(periodoDelReporte({ desde: "2011-03-01", hasta: "2011-03-31" }), "2011-03");
  assert.equal(periodoDelReporte({ desde: "2012-02-01", hasta: "2012-02-29" }), "2012-02");
  assert.equal(periodoDelReporte({ periodo: "2011-03" }), "2011-03");
  assert.equal(periodoDelReporte({}), undefined);
  for (const [desde, hasta] of [["2011-03-01", "2011-03-15"], ["2011-03-02", "2011-03-31"], ["2011-03-01", "2011-04-30"], ["2011-02-30", "2011-03-31"], ["01/03/2011", "31/03/2011"], ["2011-03-01", undefined], [undefined, "2011-03-31"]]) {
    assert.throws(() => periodoDelReporte({ desde, hasta }), (e) => e.status === 400, `${desde} ${hasta}`);
  }
});

// ---------------------------------------------------------------- modelo
test("el modelo trae solo las secciones elegidas y los 7 KPIs con los mismos valores del panel", async () => {
  const solo = await construirReporte({ periodo: "2011-03", secciones: "resumen", token: "ADMIN" });
  assert.deepEqual([solo.nombre_archivo, solo.periodo, solo.desde, solo.hasta, solo.secciones], ["KPIs_2011-03", "2011-03", "2011-03-01", "2011-03-31", ["resumen"]]);
  assert.equal(solo.cajas, undefined);
  assert.equal(solo.integraciones, undefined);
  assert.match(solo.titulo_periodo, /^Marzo de 2011 \(01\/03\/2011 – 31\/03\/2011\)$/);
  const por = Object.fromEntries(solo.resumen.kpis.map((k) => [k.id, [k.valor, k.color]]));
  assert.deepEqual(por, {
    ticket_promedio: [40, "AMARILLO"], tasa_anulacion: [4.76, "AMARILLO"], tasa_devoluciones: [1.5, "VERDE"], // 12 de Bs 800
    cumplimiento_metas: [86, "AMARILLO"], efectividad_cuadre: [82.6, "ROJO"], aceptacion_contable: [98.7, "VERDE"], dias_pago_proveedores: [5.8, "VERDE"],
  });
  // los 3 KPIs propios coinciden con el endpoint del panel
  const panel = (await (await pedir("resumen", "?periodo=2011-03")).json()).data.tarjetas;
  for (const t of panel) assert.deepEqual([t.valor, t.color], por[{ ticket_promedio: "ticket_promedio", anulacion: "tasa_anulacion", devoluciones: "tasa_devoluciones" }[t.id]]);
  assert.ok(solo.resumen.alertas.length > 0);
});

test("un servicio caido deja ese KPI sin valor ni color (con su motivo) y el reporte se genera igual", async () => {
  r.metas = "caida";
  r.aceptacion = "caida";
  const m = await construirReporte({ periodo: "2011-03", secciones: "resumen,cajas,integraciones", token: "ADMIN" });
  const por = Object.fromEntries(m.resumen.kpis.map((k) => [k.id, k]));
  assert.deepEqual([por.cumplimiento_metas.valor, por.cumplimiento_metas.color, por.cumplimiento_metas.disponible, por.cumplimiento_metas.error], [null, null, false, "boom metas"]);
  assert.equal(por.ticket_promedio.disponible, true);
  assert.deepEqual([m.cajas.cumplimiento.disponible, m.cajas.cumplimiento.error], [false, "boom metas"]);
  assert.deepEqual([m.integraciones.asientos_rechazados.disponible, m.integraciones.asientos_rechazados.error], [false, "boom aceptacion"]);
});

// ---------------------------------------------------------------- Excel (TDSI-211)
test("Excel: una hoja por cada seccion marcada, en orden, con valores numericos y el estado pintado", async () => {
  const res = await pedir("exportar.xlsx", `?desde=2011-03-01&hasta=2011-03-31&${TODAS}`);
  assert.equal(res.status, 200);
  const libro = await leerExcel(res);
  assert.deepEqual(libro.worksheets.map((h) => h.name), ["Resumen de KPIs", "Detalle por caja", "Integraciones"]);

  const resumen = libro.getWorksheet("Resumen de KPIs");
  const filas = {};
  resumen.eachRow((f) => { filas[f.getCell(1).value] = f; });
  const ticket = filas["Ticket promedio"];
  assert.deepEqual([ticket.getCell(2).value, ticket.getCell(3).value, ticket.getCell(4).value], [40, "Bs", "AMARILLO"]);
  assert.equal(ticket.getCell(4).fill.fgColor.argb, "FFFEF3C7"); // el amarillo del semaforo
  assert.equal(filas["Efectividad de cuadre"].getCell(4).fill.fgColor.argb, "FFFEE2E2"); // rojo
  assert.equal(filas["Aceptación contable"].getCell(4).fill.fgColor.argb, "FFD1FAE5"); // verde
  assert.equal(filas["Días de pago a proveedores"].getCell(2).value, 5.8);

  const cajas = libro.getWorksheet("Detalle por caja");
  const valores = [];
  cajas.eachRow((f) => valores.push(f.values.slice(1)));
  assert.ok(valores.some((v) => v[0] === "Caja 3" && v[1] === 6100 && v[2] === 10000 && v[3] === 61 && v[4] === "ROJO"));
  assert.ok(valores.some((v) => v[0] === "TUR-000045" && v[3] === -22 && v[4] === "FALTANTE")); // turno con diferencia

  const integ = [];
  libro.getWorksheet("Integraciones").eachRow((f) => integ.push(f.values.slice(1)));
  assert.ok(integ.some((v) => v[0] === "F-010482" && v[4] === "cuenta contable inexistente")); // asiento rechazado con su motivo
  assert.ok(integ.some((v) => v[0] === "OP-2026-0131" && v[2] === 3450 && v[4] === "VENCIDA"));
  assert.ok(integ.some((v) => v[0] === "OP-2026-0140" && v[4] === "PAGADA"));
});

test("Excel: solo las hojas de las secciones marcadas", async () => {
  const libro = await leerExcel(await pedir("exportar.xlsx", "?periodo=2011-03&secciones=cajas"));
  assert.deepEqual(libro.worksheets.map((h) => h.name), ["Detalle por caja"]);
  const dos = await leerExcel(await pedir("exportar.xlsx", "?periodo=2011-03&secciones=integraciones,resumen"));
  assert.deepEqual(dos.worksheets.map((h) => h.name), ["Resumen de KPIs", "Integraciones"]);
});

// ---------------------------------------------------------------- PDF (TDSI-210)
test("PDF: es un PDF con el titulo del periodo, solo las secciones marcadas y sus valores y estados", async () => {
  const modelo = await construirReporte({ periodo: "2011-03", secciones: "resumen,cajas", token: "ADMIN" });
  const pdf = await generarReportePdf(modelo, { comprimir: false });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const t = textoDelPdf(pdf);
  assert.match(t, /Reporte de KPIs/);
  assert.match(t, /Marzo de 2011 \(01\/03\/2011 – 31\/03\/2011\)/);
  assert.match(t, /Resumen de KPIs/);
  assert.match(t, /Detalle por caja/);
  assert.doesNotMatch(t, /Estado de las integraciones/); // la seccion Integraciones no se marco
  for (const esperado of ["Ticket promedio", "Bs 40,00", "4,76 %", "82,6 %", "98,7 %", "5,8 días", "AMARILLO", "ROJO", "VERDE", "Caja 3", "Sofía T.", "-Bs 22,00", "KPIs_2011-03"]) {
    assert.ok(t.includes(esperado), `falta "${esperado}" en el PDF`);
  }
});

test("PDF con la seccion Integraciones: asientos rechazados con su motivo y ordenes vencidas", async () => {
  const modelo = await construirReporte({ periodo: "2011-03", secciones: "integraciones", token: "ADMIN" });
  const t = textoDelPdf(await generarReportePdf(modelo, { comprimir: false }));
  for (const esperado of ["Estado de las integraciones", "Asientos rechazados (14)", "F-010482", "cuenta contable inexistente", "OP-2026-0131", "Distribuidora Andina", "VENCIDA", "OP-2026-0140", "PAGADA"]) {
    assert.ok(t.includes(esperado), `falta "${esperado}" en el PDF`);
  }
  assert.doesNotMatch(t, /Efectividad de cuadre/);
});

test("PDF y Excel con TODO sin datos de los servicios no fallan (secciones con 'No disponible')", async () => {
  for (const k of ["metas", "cuadre", "aceptacion", "proveedores", "devoluciones"]) r[k] = "caida";
  const modelo = await construirReporte({ periodo: "2011-03", secciones: "resumen,cajas,integraciones", token: "ADMIN" });
  const pdf = await generarReportePdf(modelo, { comprimir: false });
  assert.match(textoDelPdf(pdf), /No disponible/);
  assert.ok((await generarReporteExcel(modelo)).byteLength > 1000);
});

// ---------------------------------------------------------------- HTTP (TDSI-212)
test("la descarga trae el nombre KPIs_[periodo] en Content-Disposition (expuesto al Frontend) y el tipo del archivo", async () => {
  const pdf = await pedir("exportar.pdf", `?desde=2011-03-01&hasta=2011-03-31&${TODAS}`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(pdf.headers.get("content-disposition"), 'attachment; filename="KPIs_2011-03.pdf"');
  assert.equal(pdf.headers.get("access-control-expose-headers"), "Content-Disposition");
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  const xlsx = await pedir("exportar.xlsx", `?periodo=2011-03&${TODAS}`);
  assert.equal(xlsx.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(xlsx.headers.get("content-disposition"), 'attachment; filename="KPIs_2011-03.xlsx"');
});

test("los valores del archivo cambian con los objetivos del panel (mismos servicios de calculo): sin datos de ventas el ticket es 0", async () => {
  const m = await construirReporte({ periodo: "2011-09", secciones: "resumen", token: "ADMIN" }); // septiembre de 2011: sin ventas
  const t = m.resumen.kpis.find((k) => k.id === "ticket_promedio");
  assert.deepEqual([t.valor, t.color], [0, "ROJO"]);
});

test("errores de la descarga: sin secciones 400, seccion falsa 400, medio mes 400, sin token 401", async () => {
  assert.equal((await pedir("exportar.pdf", "?periodo=2011-03")).status, 400);
  const sin = await (await pedir("exportar.pdf", "?periodo=2011-03&secciones=")).json();
  assert.match(sin.mensaje, /al menos una sección/);
  assert.equal((await pedir("exportar.xlsx", "?periodo=2011-03&secciones=todo")).status, 400);
  const medio = await pedir("exportar.pdf", "?desde=2011-03-01&hasta=2011-03-15&secciones=resumen");
  assert.equal(medio.status, 400);
  assert.match((await medio.json()).mensaje, /mes completo/);
  assert.equal((await pedir("exportar.pdf", "?periodo=2011-13&secciones=resumen")).status, 400);
  assert.equal((await pedir("exportar.pdf", "?periodo=2011-03&secciones=resumen", null)).status, 401);
  assert.equal((await pedir("exportar.xlsx", "?periodo=2011-03&secciones=resumen", null)).status, 401);
});
