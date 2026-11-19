// La factura de una venta online sale con el metodo de pago de la orden (Efectivo, Tarjeta o QR).
// Usa un servidor HTTP local en vez del Facturacion real: el POST real de Facturacion publica la factura
// a Contabilidad (Grupo D) por Pub/Sub, y una prueba no debe hacer eso.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

let servidor;
let recibidos;
let emitirFactura;

test.before(async () => {
  servidor = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      recibidos.push({ metodo: req.method, url: req.url, cuerpo: JSON.parse(cuerpo || "{}") });
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 201;
      res.end(JSON.stringify({ ok: true, data: { numero: "F-000099", id: "1" } }));
    });
  });
  await new Promise((r) => servidor.listen(0, r));
  // el proxy lee FACTURACION_URL al cargarse: se fija ANTES de requerirlo
  process.env.FACTURACION_URL = `http://localhost:${servidor.address().port}`;
  ({ emitirFactura } = require("../services/facturacionProxy"));
});

test.beforeEach(() => {
  recibidos = [];
});

test.after(() => {
  servidor.closeAllConnections();
  return new Promise((r) => servidor.close(r));
});

test("emitirFactura manda a Facturacion el metodo de pago junto con el NIT, la razon social y los items", async () => {
  const items = [{ descripcion: "Aceite", cantidad: 2, precio_unitario: 15 }];
  const factura = await emitirFactura({ nit: "1122334455", razon_social: "Rodny Siles", items, metodo_pago: "QR", canal: "Online" });
  assert.equal(factura.numero, "F-000099");
  assert.equal(recibidos.length, 1);
  assert.equal(recibidos[0].metodo, "POST");
  assert.equal(recibidos[0].url, "/api/facturas");
  assert.deepEqual(recibidos[0].cuerpo, { nit: "1122334455", razon_social: "Rodny Siles", items, metodo_pago: "QR", canal: "Online" });
});

for (const metodo of ["Efectivo", "Tarjeta", "QR"]) {
  test(`el metodo ${metodo} viaja tal cual`, async () => {
    await emitirFactura({ nit: "1", razon_social: "X", items: [], metodo_pago: metodo });
    assert.equal(recibidos[0].cuerpo.metodo_pago, metodo);
  });
}
