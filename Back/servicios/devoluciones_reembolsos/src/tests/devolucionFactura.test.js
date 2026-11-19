// TDSI-12: GET /api/devoluciones/factura/:numero de punta a punta por HTTP.
//  - La base de devoluciones es la REAL (Supabase): se insertan devoluciones de prueba y se borran al terminar.
//  - Facturacion se imita con un servidor HTTP local solo para controlar fechas y estados de la factura
//    (las facturas reales ya tienen mas de 7 dias); la prueba contra el Facturacion real va aparte.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { query, pool } = require("../config/db");
const app = require("../app");

const SUFIJO = Date.now();
const NUM = (n) => `F-T${SUFIJO}${n}`.slice(0, 20); // numeros de factura de prueba (nunca chocan con los reales)
const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

const facturas = new Map(); // numero -> factura que "tiene" Facturacion
let facturacion;
let servidor;
let base;
let contador = 0;

function facturaDe(numero, { fecha = hace(1), estado = "Emitida", items } = {}) {
  return {
    numero,
    fecha,
    cliente_nit: "1234567",
    cliente_nombre: "Cliente de prueba",
    estado,
    total: "100.00",
    items: items ?? [
      { descripcion: "Producto A", cantidad: "5.00", precio_unitario: "10.00", subtotal: "50.00" },
      { descripcion: "Producto B", cantidad: "2.00", precio_unitario: "25.00", subtotal: "50.00" },
    ],
    metodosPago: [{ metodo: "Efectivo", monto: "100.00" }],
  };
}

async function registrarDevolucion(facturaNumero, estado, items) {
  const codigo = `DT${SUFIJO}-${++contador}`.slice(0, 20);
  const { rows } = await query(
    `INSERT INTO devoluciones.devoluciones
       (codigo, factura_numero, fecha_venta, dentro_de_plazo, tipo, metodo_pago_original, monto_total, estado)
     VALUES ($1, $2, now(), true, 'PARCIAL', 'Efectivo', 10, $3) RETURNING id`,
    [codigo, facturaNumero, estado]
  );
  for (const it of items) {
    await query(
      `INSERT INTO devoluciones.devolucion_items (devolucion_id, descripcion, cantidad, precio_unitario, subtotal)
       VALUES ($1, $2, $3, $4, $5)`,
      [rows[0].id, it.descripcion, it.cantidad, it.precio_unitario, it.cantidad * it.precio_unitario]
    );
  }
}

async function consultar(numero) {
  const r = await fetch(`${base}/api/devoluciones/factura/${encodeURIComponent(numero)}`);
  return { status: r.status, cuerpo: await r.json() };
}

test.before(async () => {
  facturacion = http.createServer((req, res) => {
    const numero = decodeURIComponent(req.url.split("/").pop());
    res.setHeader("Content-Type", "application/json");
    if (!facturas.has(numero)) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ ok: false, mensaje: "Factura no encontrada" }));
    }
    res.end(JSON.stringify({ ok: true, data: facturas.get(numero) }));
  });
  await new Promise((r) => facturacion.listen(0, r));
  process.env.FACTURACION_URL = `http://localhost:${facturacion.address().port}`;

  servidor = app.listen(0);
  await new Promise((r) => servidor.once("listening", r));
  base = `http://localhost:${servidor.address().port}`;
});

test.after(async () => {
  await query(`DELETE FROM devoluciones.devoluciones WHERE factura_numero LIKE $1`, [`F-T${SUFIJO}%`]);
  servidor.closeAllConnections();
  facturacion.closeAllConnections();
  await new Promise((r) => servidor.close(r));
  await new Promise((r) => facturacion.close(r));
  await pool.end();
});

test("factura reciente sin devoluciones: devolvible, con todo disponible", async () => {
  const numero = NUM(1);
  facturas.set(numero, facturaDe(numero));
  const { status, cuerpo } = await consultar(numero);
  assert.equal(status, 200);
  const d = cuerpo.data;
  assert.equal(d.factura.numero, numero);
  assert.equal(d.factura.cliente_nit, "1234567");
  assert.equal(d.factura.metodo_pago, "Efectivo");
  assert.equal(d.factura.total, 100);
  assert.equal(d.plazo.dentro_de_plazo, true);
  assert.equal(d.plazo.mensaje, null);
  assert.equal(d.devolvible, true);
  assert.equal(d.bloqueo, null);
  assert.deepEqual(
    d.items.map((i) => [i.descripcion, i.cantidad_comprada, i.cantidad_devuelta, i.cantidad_disponible]),
    [["Producto A", 5, 0, 5], ["Producto B", 2, 0, 2]]
  );
});

test("descuenta lo ya devuelto: pendientes, aprobadas y procesadas cuentan; las rechazadas no", async () => {
  const numero = NUM(2);
  facturas.set(numero, facturaDe(numero));
  await registrarDevolucion(numero, "PENDIENTE", [{ descripcion: "Producto A", cantidad: 2, precio_unitario: 10 }]);
  await registrarDevolucion(numero, "APROBADA", [{ descripcion: "Producto A", cantidad: 1, precio_unitario: 10 }]);
  await registrarDevolucion(numero, "RECHAZADA", [{ descripcion: "Producto A", cantidad: 4, precio_unitario: 10 }]);
  await registrarDevolucion(numero, "PROCESADA", [{ descripcion: "Producto B", cantidad: 2, precio_unitario: 25 }]);

  const { cuerpo } = await consultar(numero);
  const [a, b] = cuerpo.data.items;
  assert.deepEqual([a.cantidad_devuelta, a.cantidad_disponible], [3, 2]); // 2 + 1; la rechazada (4) no cuenta
  assert.deepEqual([b.cantidad_devuelta, b.cantidad_disponible], [2, 0]); // ya se devolvio todo
  assert.equal(cuerpo.data.devolvible, true); // dentro de plazo y valida: la pantalla decide con la cantidad disponible
});

test("el descuento distingue productos por precio y por nombre sin importar mayusculas", async () => {
  const numero = NUM(3);
  facturas.set(numero, facturaDe(numero, { items: [
    { descripcion: "Producto A", cantidad: "3.00", precio_unitario: "10.00", subtotal: "30.00" },
    { descripcion: "Producto A", cantidad: "3.00", precio_unitario: "12.00", subtotal: "36.00" },
  ] }));
  await registrarDevolucion(numero, "APROBADA", [{ descripcion: "producto a", cantidad: 1, precio_unitario: 12 }]);
  const { cuerpo } = await consultar(numero);
  assert.deepEqual(cuerpo.data.items.map((i) => i.cantidad_disponible), [3, 2]);
});

test("misma descripcion y precio en dos lineas: lo devuelto se reparte sin descontarse dos veces", async () => {
  const numero = NUM(4);
  facturas.set(numero, facturaDe(numero, { items: [
    { descripcion: "Producto A", cantidad: "2.00", precio_unitario: "10.00", subtotal: "20.00" },
    { descripcion: "Producto A", cantidad: "2.00", precio_unitario: "10.00", subtotal: "20.00" },
  ] }));
  await registrarDevolucion(numero, "PROCESADA", [{ descripcion: "Producto A", cantidad: 3, precio_unitario: 10 }]);
  const { cuerpo } = await consultar(numero);
  assert.deepEqual(cuerpo.data.items.map((i) => [i.cantidad_devuelta, i.cantidad_disponible]), [[2, 0], [1, 1]]);
});

test("factura de hace mas de 7 dias: Fuera de plazo y no devolvible", async () => {
  const numero = NUM(5);
  facturas.set(numero, facturaDe(numero, { fecha: hace(9) }));
  const { status, cuerpo } = await consultar(numero);
  assert.equal(status, 200);
  assert.equal(cuerpo.data.plazo.dentro_de_plazo, false);
  assert.equal(cuerpo.data.plazo.mensaje, "Fuera de plazo");
  assert.ok(cuerpo.data.plazo.dias_transcurridos >= 8);
  assert.equal(cuerpo.data.devolvible, false);
  assert.deepEqual(cuerpo.data.bloqueo, { codigo: "FUERA_DE_PLAZO", mensaje: "Fuera de plazo" });
  assert.equal(cuerpo.data.items.length, 2); // igual se muestran los productos
});

test("factura anulada: no se puede devolver aunque este dentro de plazo", async () => {
  const numero = NUM(6);
  facturas.set(numero, facturaDe(numero, { estado: "Anulada" }));
  const { cuerpo } = await consultar(numero);
  assert.equal(cuerpo.data.plazo.dentro_de_plazo, true);
  assert.equal(cuerpo.data.devolvible, false);
  assert.equal(cuerpo.data.bloqueo.codigo, "FACTURA_NO_VALIDA");
  assert.match(cuerpo.data.bloqueo.mensaje, /anulada/);
});

test("factura con anulacion solicitada tampoco es valida para devolver", async () => {
  const numero = NUM(7);
  facturas.set(numero, facturaDe(numero, { estado: "AnulacionSolicitada" }));
  const { cuerpo } = await consultar(numero);
  assert.equal(cuerpo.data.devolvible, false);
  assert.equal(cuerpo.data.bloqueo.codigo, "FACTURA_NO_VALIDA");
});

test("factura inexistente: 404 No se encontró la factura", async () => {
  const { status, cuerpo } = await consultar(NUM(99));
  assert.equal(status, 404);
  assert.equal(cuerpo.ok, false);
  assert.equal(cuerpo.mensaje, "No se encontró la factura");
});

test("numero vacio o invalido: 400", async () => {
  assert.equal((await consultar("   ")).status, 400);
  assert.equal((await consultar("F 000123")).status, 400);
});

test("el numero se acepta en minusculas y con espacios", async () => {
  const numero = NUM(8);
  facturas.set(numero, facturaDe(numero));
  const { status, cuerpo } = await consultar(`  ${numero.toLowerCase()} `);
  assert.equal(status, 200);
  assert.equal(cuerpo.data.factura.numero, numero);
});
