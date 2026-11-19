// TDSI-118: filtro origen (TIENDA o MARKETPLACE) en GET /api/devoluciones. BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
const SUF = String(Date.now()).slice(-7);
const CAJERO = `origen.${SUF}@tallersis.test`;
const c = {};

async function registrar(n) {
  const numero = entorno.agregarFactura(n);
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: CAJERO });
  return cuerpo.data.codigo;
}
const listar = (qs, conToken = true) => fetch(`${entorno.base}/api/devoluciones?${qs}`, { headers: conToken ? entorno.cabeceraAdmin : {} }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));
const codigos = (r) => r.cuerpo.data.map((f) => f.codigo).sort();

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  c.tienda1 = await registrar(1);
  c.tienda2 = await registrar(2);
  c.mkt1 = await registrar(3);
  c.mkt2 = await registrar(4);
  await query(`UPDATE devoluciones.devoluciones SET origen = 'MARKETPLACE', orden_id = 'ORD-' || codigo, estado = 'APROBADA' WHERE codigo = $1`, [c.mkt2]);
  await query(`UPDATE devoluciones.devoluciones SET origen = 'MARKETPLACE', orden_id = 'ORD-' || codigo WHERE codigo = $1`, [c.mkt1]);
});
test.after(() => entorno.cerrar());

test("origen=MARKETPLACE trae solo las de pedidos online; origen=TIENDA solo las de caja", async () => {
  assert.deepEqual(codigos(await listar(`cajero=${SUF}&origen=MARKETPLACE`)), [c.mkt1, c.mkt2].sort());
  assert.deepEqual(codigos(await listar(`cajero=${SUF}&origen=TIENDA`)), [c.tienda1, c.tienda2].sort());
  assert.deepEqual(codigos(await listar(`cajero=${SUF}`)), [c.tienda1, c.tienda2, c.mkt1, c.mkt2].sort()); // sin filtro, todas
});

test("no distingue mayusculas y se combina con estado y paginacion", async () => {
  assert.deepEqual(codigos(await listar(`cajero=${SUF}&origen=marketplace&estado=aprobada`)), [c.mkt2]);
  const r = await listar(`cajero=${SUF}&origen=Marketplace&pagina=1`);
  assert.deepEqual([r.cuerpo.total, r.cuerpo.pagina, r.cuerpo.total_paginas], [2, 1, 1]);
});

test("cada fila trae su origen y su numero de orden (la etiqueta 'Marketplace' y la orden de la bandeja)", async () => {
  const filas = (await listar(`cajero=${SUF}`)).cuerpo.data;
  const por = Object.fromEntries(filas.map((f) => [f.codigo, [f.origen, f.orden_id]]));
  assert.deepEqual(por[c.tienda1], ["TIENDA", null]);
  assert.deepEqual(por[c.mkt1], ["MARKETPLACE", `ORD-${c.mkt1}`]);
});

test("la bandeja del SUPERVISOR (?estado=PENDIENTE) acepta el filtro de origen sin token de administrador", async () => {
  const r = await listar(`estado=PENDIENTE&origen=MARKETPLACE`, false);
  assert.equal(r.status, 200);
  assert.ok(r.cuerpo.data.every((f) => f.origen === "MARKETPLACE" && f.estado === "PENDIENTE"));
  assert.ok(r.cuerpo.data.some((f) => f.codigo === c.mkt1));
  assert.ok(!r.cuerpo.data.some((f) => f.codigo === c.mkt2)); // esa esta APROBADA
});

test("un origen invalido da 400", async () => {
  for (const origen of ["WEB", "tienda online", "1"]) {
    const r = await listar(`origen=${encodeURIComponent(origen)}`);
    assert.equal(r.status, 400, origen);
    assert.match(r.cuerpo.mensaje, /El origen debe ser uno de: TIENDA, MARKETPLACE/);
  }
});

test("la exportacion a Excel respeta el mismo filtro de origen", async () => {
  const r = await fetch(`${entorno.base}/api/devoluciones/exportar?cajero=${SUF}&origen=MARKETPLACE`, { headers: entorno.cabeceraAdmin });
  assert.equal(r.status, 200);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(Buffer.from(await r.arrayBuffer()));
  const codigosXlsx = [];
  libro.getWorksheet("Devoluciones").eachRow((fila, n) => { if (n > 1 && String(fila.values[1]).startsWith("DEV-")) codigosXlsx.push(fila.values[1]); });
  assert.deepEqual(codigosXlsx.sort(), [c.mkt1, c.mkt2].sort());
  assert.equal((await fetch(`${entorno.base}/api/devoluciones/exportar?origen=otro`, { headers: entorno.cabeceraAdmin })).status, 400);
});
