// TDSI-81: GET /api/devoluciones/exportar (Excel con los mismos filtros que la tabla). BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
const SUF = String(Date.now()).slice(-7);
const CAJERO = `exporta.${SUF}@tallersis.test`;
const codigos = {};

async function registrar(n, cantidad = 1) {
  const numero = entorno.agregarFactura(n);
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad }], motivo_id: motivoId, cajero: CAJERO });
  return cuerpo.data.codigo;
}
const fijar = (codigo, ts, estado) => query(`UPDATE devoluciones.devoluciones SET fecha_solicitud = $2::timestamptz, estado = $3 WHERE codigo = $1`, [codigo, ts, estado]);

async function exportar(qs) {
  const r = await fetch(`${entorno.base}/api/devoluciones/exportar?${qs}`, { headers: entorno.cabeceraAdmin });
  const buf = Buffer.from(await r.arrayBuffer());
  return { r, buf };
}
async function hoja(buf) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buf);
  return libro.getWorksheet("Devoluciones");
}
const filasDe = (ws) => {
  const filas = [];
  ws.eachRow((fila, n) => n > 1 && filas.push(fila.values.slice(1)));
  return filas;
};

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  codigos.a = await registrar(1, 2); // 20 Bs
  codigos.b = await registrar(2, 3); // 30 Bs
  codigos.c = await registrar(3, 1); // 10 Bs
  await fijar(codigos.a, "2026-05-10 09:00:00-04", "RECHAZADA");
  await fijar(codigos.b, "2026-05-10 23:30:00-04", "PROCESADA");
  await fijar(codigos.c, "2026-05-12 08:00:00-04", "PROCESADA");
});
test.after(() => entorno.cerrar());

test("descarga un .xlsx con el nombre devoluciones-AAAA-MM-DD y las columnas de la tabla", async () => {
  const { r, buf } = await exportar(`cajero=${SUF}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.match(r.headers.get("content-disposition"), /^attachment; filename="devoluciones-\d{4}-\d{2}-\d{2}\.xlsx"$/);
  assert.equal(buf.subarray(0, 2).toString(), "PK"); // un .xlsx es un zip
  const ws = await hoja(buf);
  assert.deepEqual(ws.getRow(1).values.slice(1), ["Código", "Factura", "Cajero", "Tipo", "Motivo", "Monto (Bs)", "Estado", "Fecha (Bolivia)", "Requiere autorización"]);
});

test("trae las mismas filas que la tabla con esos filtros (desde, hasta y estado), con montos numericos y fecha de Bolivia", async () => {
  const filtros = `cajero=${SUF}&desde=2026-05-10&hasta=2026-05-10`;
  const lista = (await entorno.get(`/api/devoluciones?${filtros}`)).cuerpo.data.map((f) => f.codigo).sort();
  const ws = await hoja((await exportar(filtros)).buf);
  const filas = filasDe(ws);
  const datos = filas.filter((f) => String(f[0]).startsWith("DEV-"));
  assert.deepEqual(datos.map((f) => f[0]).sort(), lista);
  assert.deepEqual(lista, [codigos.a, codigos.b].sort());
  const fila = datos.find((f) => f[0] === codigos.a);
  assert.deepEqual([fila[2], fila[3], fila[5], fila[6], fila[7]], [CAJERO, "PARCIAL", 20, "RECHAZADA", "10/05/2026, 09:00"]);
  assert.equal(typeof fila[5], "number");

  const soloProcesadas = filasDe(await hoja((await exportar(`${filtros}&estado=procesada`)).buf)).filter((f) => String(f[0]).startsWith("DEV-"));
  assert.deepEqual(soloProcesadas.map((f) => f[0]), [codigos.b]);
});

test("al final suma los montos de lo exportado", async () => {
  const filas = filasDe(await hoja((await exportar(`cajero=${SUF}`)).buf));
  const pie = filas.at(-1);
  assert.match(pie[2], /^Total \(3 devoluciones\)$/);
  assert.equal(pie[5], 60);
});

test("NO pagina: exporta todo lo que se esta viendo aunque sean mas de 20 filas", async () => {
  await query(
    `INSERT INTO devoluciones.devoluciones (codigo, factura_numero, cliente_nit, fecha_venta, fecha_solicitud, dentro_de_plazo, tipo, motivo_id, metodo_pago_original, monto_total, estado, creado_por)
     SELECT 'DEVXP' || $2 || g, d.factura_numero, d.cliente_nit, d.fecha_venta, '2026-06-01 12:00:00-04'::timestamptz + g * interval '1 minute', true, d.tipo, d.motivo_id, d.metodo_pago_original, 5, 'APROBADA', $3
       FROM devoluciones.devoluciones d, generate_series(1, 45) g WHERE d.codigo = $1`,
    [codigos.a, SUF, `masivo.${SUF}@tallersis.test`]
  );
  const { r, buf } = await exportar(`cajero=masivo.${SUF}&pagina=1`);
  assert.equal(r.headers.get("x-total-filas"), "45");
  assert.equal(r.headers.get("x-exportacion-truncada"), null);
  assert.equal(filasDe(await hoja(buf)).filter((f) => String(f[0]).startsWith("DEVXP")).length, 45);
});

test("sin resultados baja un Excel solo con los encabezados; filtros invalidos dan 400", async () => {
  const { r, buf } = await exportar(`cajero=nadie.${SUF}`);
  assert.equal(r.status, 200);
  const filas = filasDe(await hoja(buf));
  assert.equal(filas.filter((f) => String(f[0]).startsWith("DEV")).length, 0);
  for (const qs of ["desde=2026-99-99", "desde=2026-05-12&hasta=2026-05-10", "estado=otra"]) {
    assert.equal((await exportar(qs)).r.status, 400, qs);
  }
});
