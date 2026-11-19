// TDSI-22: la devolucion se guarda en estado PENDIENTE con su codigo correlativo DEV-0001 y sus items,
// todo en una misma transaccion (base real).
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
const CAJERO = "cajero.prueba@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});

test.after(() => entorno.cerrar());

const registrar = (numero, items, extra = {}) =>
  entorno.post("/api/devoluciones", { factura_numero: numero, items, motivo_id: motivoId, cajero: CAJERO, ...extra });

const numeroDe = (codigo) => Number(codigo.replace("DEV-", ""));

test("guarda la devolucion PENDIENTE con su codigo DEV-NNNN, sus items y quien la registro", async () => {
  const numero = entorno.agregarFactura(1);
  const { status, cuerpo } = await registrar(numero, [
    { descripcion: "Producto A", cantidad: 2, estado_producto: "BUEN_ESTADO" },
    { descripcion: "Producto B", cantidad: 1, estado_producto: "BUEN_ESTADO" },
  ], { observaciones: "Llego roto" });

  assert.equal(status, 201);
  assert.equal(cuerpo.mensaje, "Devolución registrada");
  assert.match(cuerpo.data.codigo, /^DEV-\d{4,}$/);
  assert.equal(cuerpo.data.estado, "PENDIENTE");
  assert.equal(cuerpo.data.tipo, "PARCIAL");
  assert.equal(cuerpo.data.monto_total, 45);
  assert.equal(cuerpo.data.cajero, CAJERO);
  assert.equal(cuerpo.data.comprados, undefined); // dato interno: no sale por la API

  const { rows } = await query(`SELECT * FROM devoluciones.devoluciones WHERE codigo = $1`, [cuerpo.data.codigo]);
  assert.equal(rows.length, 1);
  const d = rows[0];
  assert.equal(d.factura_numero, numero);
  assert.equal(d.estado, "PENDIENTE");
  assert.equal(d.tipo, "PARCIAL");
  assert.equal(Number(d.monto_total), 45);
  assert.equal(Number(d.motivo_id), motivoId);
  assert.equal(d.observaciones, "Llego roto");
  assert.equal(d.creado_por, CAJERO);
  assert.equal(d.cliente_nit, "1234567");
  assert.equal(d.dentro_de_plazo, true);
  assert.equal(d.metodo_pago_original, "Efectivo");

  const { rows: items } = await query(`SELECT descripcion, cantidad, precio_unitario, subtotal FROM devoluciones.devolucion_items WHERE devolucion_id = $1 ORDER BY id`, [d.id]);
  assert.deepEqual(items.map((i) => [i.descripcion, Number(i.cantidad), Number(i.precio_unitario), Number(i.subtotal)]), [
    ["Producto A", 2, 10, 20],
    ["Producto B", 1, 25, 25],
  ]);
});

test("el codigo es correlativo: cada devolucion recibe el siguiente numero", async () => {
  const a = await registrar(entorno.agregarFactura(2), [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }]);
  const b = await registrar(entorno.agregarFactura(3), [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }]);
  assert.equal(numeroDe(b.cuerpo.data.codigo), numeroDe(a.cuerpo.data.codigo) + 1);
});

test("varias devoluciones al mismo tiempo reciben codigos distintos y seguidos", async () => {
  const numeros = [4, 5, 6, 7, 8, 9].map((n) => entorno.agregarFactura(n));
  const respuestas = await Promise.all(numeros.map((n) => registrar(n, [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }])));
  assert.ok(respuestas.every((r) => r.status === 201), JSON.stringify(respuestas.map((r) => r.status)));
  const codigos = respuestas.map((r) => numeroDe(r.cuerpo.data.codigo)).sort((x, y) => x - y);
  assert.equal(new Set(codigos).size, 6, "codigos repetidos: " + codigos);
  for (let i = 1; i < codigos.length; i++) assert.equal(codigos[i], codigos[i - 1] + 1, "hay huecos: " + codigos);
});

test("dos devoluciones simultaneas de lo mismo: solo una cabe, la otra recibe 409", async () => {
  const numero = entorno.agregarFactura(10); // Producto A: 5 comprados
  const items = [{ descripcion: "Producto A", cantidad: 3, estado_producto: "BUEN_ESTADO" }];
  const [r1, r2] = await Promise.all([registrar(numero, items), registrar(numero, items)]);
  const estados = [r1.status, r2.status].sort();
  assert.deepEqual(estados, [201, 409]);
  const rechazada = r1.status === 409 ? r1 : r2;
  assert.match(rechazada.cuerpo.mensaje, /Otra devolución de esta factura se registró mientras tanto/);

  const { rows } = await query(`SELECT SUM(i.cantidad) AS total FROM devoluciones.devolucion_items i JOIN devoluciones.devoluciones d ON d.id = i.devolucion_id WHERE d.factura_numero = $1`, [numero]);
  assert.equal(Number(rows[0].total), 3, "no debe haberse devuelto de mas");
});

test("si algo falla al guardar, no queda nada a medias ni se gasta un codigo", async () => {
  // una descripcion de mas de 200 caracteres no cabe en devolucion_items.descripcion: falla DESPUES de insertar la cabecera
  const larga = "X".repeat(250);
  const numero = entorno.agregarFactura(11, { items: [{ descripcion: larga, cantidad: "2.00", precio_unitario: "10.00", subtotal: "20.00" }] });
  const r = await registrar(numero, [{ descripcion: larga, cantidad: 1, estado_producto: "BUEN_ESTADO" }]);
  assert.equal(r.status, 500);
  const { rows } = await query(`SELECT count(*)::int n FROM devoluciones.devoluciones WHERE factura_numero = $1`, [numero]);
  assert.equal(rows[0].n, 0, "la cabecera no debio quedar guardada");

  // y el siguiente codigo sigue sin huecos
  const ok1 = await registrar(entorno.agregarFactura(12), [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }]);
  const ok2 = await registrar(entorno.agregarFactura(13), [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }]);
  assert.equal(numeroDe(ok2.cuerpo.data.codigo), numeroDe(ok1.cuerpo.data.codigo) + 1);
});

test("el cajero es obligatorio", async () => {
  const numero = entorno.agregarFactura(14);
  for (const cajero of [undefined, "", "   ", 123, "x".repeat(61)]) {
    const r = await registrar(numero, [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }], { cajero });
    assert.equal(r.status, 400, `deberia rechazar cajero ${JSON.stringify(cajero)}`);
  }
  const { rows } = await query(`SELECT count(*)::int n FROM devoluciones.devoluciones WHERE factura_numero = $1`, [numero]);
  assert.equal(rows[0].n, 0);
});

test("una devolucion registrada descuenta de lo disponible en la consulta de la factura", async () => {
  const numero = entorno.agregarFactura(15);
  await registrar(numero, [{ descripcion: "Producto A", cantidad: 4, estado_producto: "BUEN_ESTADO" }]);
  const { cuerpo } = await entorno.get(`/api/devoluciones/factura/${numero}`);
  const a = cuerpo.data.items.find((i) => i.descripcion === "Producto A");
  assert.deepEqual([a.cantidad_devuelta, a.cantidad_disponible], [4, 1]);
});

test("una devolucion TOTAL queda registrada como TOTAL y agota la factura", async () => {
  const numero = entorno.agregarFactura(16);
  const r = await registrar(numero, [{ descripcion: "Producto A", cantidad: 5, estado_producto: "BUEN_ESTADO" }, { descripcion: "Producto B", cantidad: 2, estado_producto: "BUEN_ESTADO" }]);
  assert.equal(r.cuerpo.data.tipo, "TOTAL");
  const otra = await registrar(numero, [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }]);
  assert.equal(otra.status, 422); // ya no queda nada
});
