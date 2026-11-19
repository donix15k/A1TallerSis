// TDSI-11: FacturacionProxy.obtenerFactura contra un servidor HTTP local que imita a Facturacion
// (no se mockea fetch: se hace una llamada HTTP de verdad). La verificacion contra el servicio real
// de Facturacion se hace aparte, con el servicio levantado.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { obtenerFactura } = require("../services/facturacionProxy");

const FACTURA = {
  numero: "F-000099",
  fecha: "2026-11-15T14:00:00.000Z",
  cliente_nit: "1122334455",
  cliente_nombre: "Rodny Siles",
  estado: "Emitida",
  total: "48.00",
  items: [
    { descripcion: "Aceite Fino 900ml", cantidad: "2.00", precio_unitario: "15.00", subtotal: "30.00" },
    { descripcion: "Fideo Coronilla 500g", cantidad: "3.00", precio_unitario: "6.00", subtotal: "18.00" },
  ],
  metodosPago: [{ metodo: "Efectivo", monto: "48.00" }],
};

let servidor;
let llamadas;
let comportamiento = "ok"; // ok | 404 | 500 | colgado | mixto | sin-metodo

test.before(async () => {
  servidor = http.createServer((req, res) => {
    llamadas.push(req.url);
    if (comportamiento === "colgado") return; // nunca responde
    res.setHeader("Content-Type", "application/json");
    if (comportamiento === "404") {
      res.statusCode = 404;
      return res.end(JSON.stringify({ ok: false, mensaje: "Factura no encontrada" }));
    }
    if (comportamiento === "500") {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, mensaje: "Error interno del servidor" }));
    }
    const data = { ...FACTURA };
    if (comportamiento === "mixto") data.metodosPago = [{ metodo: "Efectivo", monto: "20.00" }, { metodo: "QR", monto: "28.00" }];
    if (comportamiento === "sin-metodo") data.metodosPago = [];
    res.end(JSON.stringify({ ok: true, data }));
  });
  await new Promise((r) => servidor.listen(0, r));
  process.env.FACTURACION_URL = `http://localhost:${servidor.address().port}`;
});

test.beforeEach(() => {
  llamadas = [];
  comportamiento = "ok";
  process.env.FACTURACION_TIMEOUT_MS = "5000";
});

test.after(() => {
  servidor.closeAllConnections();
  return new Promise((r) => servidor.close(r));
});

test("devuelve la factura normalizada: numeros como Number, items, fecha, NIT y metodo de pago", async () => {
  const f = await obtenerFactura("F-000099");
  assert.equal(llamadas[0], "/api/facturas/F-000099");
  assert.equal(f.numero, "F-000099");
  assert.equal(f.fecha, "2026-11-15T14:00:00.000Z");
  assert.equal(f.cliente_nit, "1122334455");
  assert.equal(f.estado, "Emitida");
  assert.equal(f.total, 48);
  assert.deepEqual(f.items[0], { descripcion: "Aceite Fino 900ml", cantidad: 2, precio_unitario: 15, subtotal: 30 });
  assert.equal(f.items.length, 2);
  assert.equal(f.metodo_pago, "Efectivo");
  assert.deepEqual(f.metodos_pago, [{ metodo: "Efectivo", monto: 48 }]);
});

test("normaliza el numero que escribe el cajero (minusculas y espacios)", async () => {
  await obtenerFactura("  f-000099 ");
  assert.equal(llamadas[0], "/api/facturas/F-000099");
});

test("pago con varios metodos -> Mixto; sin metodos registrados -> null", async () => {
  comportamiento = "mixto";
  assert.equal((await obtenerFactura("F-000099")).metodo_pago, "Mixto");
  comportamiento = "sin-metodo";
  const f = await obtenerFactura("F-000099");
  assert.equal(f.metodo_pago, null);
  assert.deepEqual(f.metodos_pago, []);
});

test("factura inexistente -> 404 No se encontró la factura", async () => {
  comportamiento = "404";
  await assert.rejects(obtenerFactura("F-999999"), (e) => e.status === 404 && e.message === "No se encontró la factura");
});

test("error de Facturacion -> 502 con su mensaje", async () => {
  comportamiento = "500";
  await assert.rejects(obtenerFactura("F-000099"), (e) => e.status === 502 && /Error interno/.test(e.message));
});

test("Facturacion que no responde a tiempo -> 503", async () => {
  comportamiento = "colgado";
  process.env.FACTURACION_TIMEOUT_MS = "200";
  await assert.rejects(obtenerFactura("F-000099"), (e) => e.status === 503 && /no respondió a tiempo/.test(e.message));
});

test("Facturacion caida -> 503", async () => {
  const urlAnterior = process.env.FACTURACION_URL;
  process.env.FACTURACION_URL = "http://localhost:1"; // puerto cerrado
  try {
    await assert.rejects(obtenerFactura("F-000099"), (e) => e.status === 503 && /No se pudo conectar/.test(e.message));
  } finally {
    process.env.FACTURACION_URL = urlAnterior;
  }
});

test("numero vacio o con caracteres raros -> 400 sin llamar a Facturacion", async () => {
  for (const malo of ["", "   ", null, "F-1/../x", "F 000123", "F-0001230000000000000000"]) {
    await assert.rejects(obtenerFactura(malo), (e) => e.status === 400, `deberia rechazar ${JSON.stringify(malo)}`);
  }
  assert.equal(llamadas.length, 0);
});
