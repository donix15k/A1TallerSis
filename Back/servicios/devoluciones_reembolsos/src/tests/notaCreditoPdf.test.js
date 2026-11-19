// TDSI-58: GET /api/devoluciones/:codigo/nota-credito.pdf. BD real, Facturacion simulado; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { armarNota } = require("../services/notaCreditoService");
const { montoEnLetras } = require("../utils/numeroALetras");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.pdf@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});
test.after(() => entorno.cerrar());

async function devolucion({ cantidad = 4, procesar = true, aprobar = true } = {}) {
  const numero = entorno.agregarFactura(950 + ++contador, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad }], motivo_id: motivoId, cajero: CAJERO });
  const codigo = cuerpo.data.codigo;
  if (aprobar) await entorno.post(`/api/devoluciones/${codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  if (procesar) await entorno.post(`/api/devoluciones/${codigo}/reembolsar`, { cajero: CAJERO });
  return { codigo, numero };
}

test("devuelve un PDF de verdad (application/pdf, empieza con %PDF) de la devolucion procesada", async () => {
  const { codigo } = await devolucion();
  const r = await fetch(`${entorno.base}/api/devoluciones/${codigo}/nota-credito.pdf`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.match(r.headers.get("content-disposition"), new RegExp(`nota-credito-${codigo}\\.pdf`));
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(buf.length > 2000);
});

test("la nota lleva los datos de la empresa, la factura original, los productos devueltos y el monto en letras", async () => {
  const { codigo, numero } = await devolucion({ cantidad: 4 });
  const d = await armarNota(codigo);
  assert.match(d.nota.numero, /^NC-\d{6}$/);
  assert.equal(d.nota.monto, 40);
  assert.deepEqual([d.empresa.nombre, d.empresa.nit], ["Vortrix", "1009876015"]);
  assert.equal(d.factura.numero, numero);
  assert.deepEqual(d.devolucion.items.map((i) => [i.descripcion, i.cantidad, i.subtotal]), [["Producto A", 4, 40]]);
  assert.equal(montoEnLetras(d.nota.monto), "CUARENTA BOLIVIANOS CON 00/100");
});

test("una devolucion que aun no esta procesada no tiene nota: 409; codigo inexistente: 404", async () => {
  const { codigo } = await devolucion({ procesar: false });
  const r = await fetch(`${entorno.base}/api/devoluciones/${codigo}/nota-credito.pdf`);
  assert.equal(r.status, 409);
  assert.match((await r.json()).mensaje, /todavía no tiene nota de crédito/);
  assert.equal((await fetch(`${entorno.base}/api/devoluciones/DEV-999999/nota-credito.pdf`)).status, 404);
});

test("el PDF crece sin romperse con muchos productos devueltos (pagina nueva)", async () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ descripcion: `Producto largo numero ${i + 1} de la factura`, cantidad: "1.00", precio_unitario: "1.00", subtotal: "1.00" }));
  const numero = entorno.agregarFactura(990 + ++contador, { metodosPago: [{ metodo: "QR", monto: 40 }], items });
  entorno.facturas.get(numero).total = "40.00";
  const { cuerpo } = await entorno.post("/api/devoluciones", {
    factura_numero: numero, items: items.map((i) => ({ descripcion: i.descripcion, cantidad: 1 })), motivo_id: motivoId, cajero: CAJERO,
  });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  assert.equal((await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/reembolsar`, { cajero: CAJERO })).status, 201);
  const r = await fetch(`${entorno.base}/api/devoluciones/${cuerpo.data.codigo}/nota-credito.pdf`);
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.ok((buf.toString("latin1").match(/\/Type \/Page\b/g) || []).length >= 2);
});
