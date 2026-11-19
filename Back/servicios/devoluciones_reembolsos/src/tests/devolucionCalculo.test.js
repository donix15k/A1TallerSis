// TDSI-21: POST /api/devoluciones valida productos y cantidades contra la factura, calcula el monto y marca
// TOTAL o PARCIAL. (Desde TDSI-22 la solicitud valida tambien se guarda; aqui se revisa la validacion y el calculo.)
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { iniciarEntorno, hace } = require("./helpers/entorno");
const { calcularMonto } = require("../services/devolucionService");

let entorno;
let motivoId;
let motivoInactivoId;

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  const { rows } = await query(`INSERT INTO devoluciones.motivos (nombre, activo) VALUES ($1, false) RETURNING id`, [`Inactivo calculo ${entorno.SUFIJO}`]);
  motivoInactivoId = Number(rows[0].id);
});

test.after(async () => {
  await query(`DELETE FROM devoluciones.motivos WHERE id = $1`, [motivoInactivoId]);
  await entorno.cerrar();
});

const solicitud = (numero, items, extra = {}) => ({ factura_numero: numero, items, motivo_id: motivoId, cajero: "cajero.prueba@tallersis.test", ...extra });

test("calcularMonto suma cantidad x precio con 2 decimales", () => {
  assert.equal(calcularMonto([{ cantidad: 2, precio_unitario: 10 }, { cantidad: 1.5, precio_unitario: 3.3 }]), 24.95);
  assert.equal(calcularMonto([{ cantidad: 3, precio_unitario: 0.1 }]), 0.3); // sin el error clasico de 0.30000000000000004
  // media centavo: 1.5 x 3.33 = 4.995 -> 5.00 (mitad hacia arriba, sin error de coma flotante)
  assert.equal(calcularMonto([{ cantidad: 1.5, precio_unitario: 3.33 }]), 5);
  // el monto es la suma de los subtotales ya redondeados: 3 x (0.333 -> 0.33... ) se mantiene consistente
  assert.equal(calcularMonto([{ cantidad: 1.5, precio_unitario: 3.33 }, { cantidad: 1.5, precio_unitario: 3.33 }]), 10);
});

test("devolucion parcial: monto con los precios de la factura y tipo PARCIAL", async () => {
  const numero = entorno.agregarFactura(1);
  const { status, cuerpo } = await entorno.post("/api/devoluciones", solicitud(numero, [
    { descripcion: "Producto A", cantidad: 2 },
    { descripcion: "Producto B", cantidad: 1 },
  ], { observaciones: "  Llego roto  " }));
  assert.equal(status, 201);
  const d = cuerpo.data;
  assert.equal(d.tipo, "PARCIAL");
  assert.equal(d.monto_total, 45); // 2 x 10 + 1 x 25
  assert.deepEqual(d.items, [
    { descripcion: "Producto A", cantidad: 2, precio_unitario: 10, subtotal: 20 },
    { descripcion: "Producto B", cantidad: 1, precio_unitario: 25, subtotal: 25 },
  ]);
  assert.equal(d.motivo.id, motivoId);
  assert.equal(d.observaciones, "Llego roto");
  assert.equal(d.factura_numero, numero);
});

test("devolver todo lo comprado de cada producto: tipo TOTAL", async () => {
  const numero = entorno.agregarFactura(2);
  const { cuerpo } = await entorno.post("/api/devoluciones", solicitud(numero, [
    { descripcion: "Producto A", cantidad: 5 },
    { descripcion: "Producto B", cantidad: 2 },
  ]));
  assert.equal(cuerpo.data.tipo, "TOTAL");
  assert.equal(cuerpo.data.monto_total, 100);
});

test("el monto sale de los precios de la factura, aunque el cliente mande otro precio", async () => {
  const numero = entorno.agregarFactura(3);
  const { cuerpo } = await entorno.post("/api/devoluciones", solicitud(numero, [{ descripcion: "Producto A", cantidad: 1, precio_unitario: 10 }]));
  assert.equal(cuerpo.data.monto_total, 10);
  const mal = await entorno.post("/api/devoluciones", solicitud(numero, [{ descripcion: "Producto A", cantidad: 1, precio_unitario: 1 }]));
  assert.equal(mal.status, 422); // ese precio no es el de la factura
});

test("no se puede devolver mas de lo disponible (descontando devoluciones anteriores)", async () => {
  const numero = entorno.agregarFactura(4);
  const { rows } = await query(
    `INSERT INTO devoluciones.devoluciones (codigo, factura_numero, fecha_venta, dentro_de_plazo, tipo, metodo_pago_original, monto_total, estado)
     VALUES ($1, $2, now(), true, 'PARCIAL', 'Efectivo', 30, 'PENDIENTE') RETURNING id`,
    [`DC${entorno.SUFIJO}`.slice(0, 20), numero]
  );
  await query(`INSERT INTO devoluciones.devolucion_items (devolucion_id, descripcion, cantidad, precio_unitario, subtotal) VALUES ($1, 'Producto A', 3, 10, 30)`, [rows[0].id]);

  const demasiado = await entorno.post("/api/devoluciones", solicitud(numero, [{ descripcion: "Producto A", cantidad: 3 }]));
  assert.equal(demasiado.status, 422);
  assert.match(demasiado.cuerpo.mensaje, /solo quedan 2 disponibles/);
  assert.equal(demasiado.cuerpo.detalle.disponible, 2);

  const justo = await entorno.post("/api/devoluciones", solicitud(numero, [{ descripcion: "Producto A", cantidad: 2 }]));
  assert.equal(justo.status, 201);
  assert.equal(justo.cuerpo.data.tipo, "PARCIAL"); // ya hay devoluciones previas: esta sola no devuelve "todo lo comprado"
});

test("cantidades invalidas: cero, negativa, texto, mas de 2 decimales", async () => {
  const numero = entorno.agregarFactura(5);
  for (const cantidad of [0, -1, "dos", null, 1.005]) {
    const r = await entorno.post("/api/devoluciones", solicitud(numero, [{ descripcion: "Producto A", cantidad }]));
    assert.equal(r.status, 400, `deberia rechazar cantidad ${JSON.stringify(cantidad)}`);
  }
});

test("producto que no esta en la factura, repetido o sin productos", async () => {
  const numero = entorno.agregarFactura(6);
  assert.equal((await entorno.post("/api/devoluciones", solicitud(numero, [{ descripcion: "Otro producto", cantidad: 1 }]))).status, 422);
  assert.equal((await entorno.post("/api/devoluciones", solicitud(numero, [{ descripcion: "Producto A", cantidad: 1 }, { descripcion: "producto a", cantidad: 1 }]))).status, 400);
  assert.equal((await entorno.post("/api/devoluciones", solicitud(numero, []))).status, 400);
  assert.equal((await entorno.post("/api/devoluciones", { factura_numero: numero, motivo_id: motivoId })).status, 400);
});

test("mismo producto con dos precios en la factura: hay que indicar el precio", async () => {
  const numero = entorno.agregarFactura(7, { items: [
    { descripcion: "Producto A", cantidad: "2.00", precio_unitario: "10.00", subtotal: "20.00" },
    { descripcion: "Producto A", cantidad: "2.00", precio_unitario: "12.00", subtotal: "24.00" },
  ] });
  const ambiguo = await entorno.post("/api/devoluciones", solicitud(numero, [{ descripcion: "Producto A", cantidad: 1 }]));
  assert.equal(ambiguo.status, 400);
  const claro = await entorno.post("/api/devoluciones", solicitud(numero, [{ descripcion: "Producto A", cantidad: 1, precio_unitario: 12 }]));
  assert.equal(claro.status, 201);
  assert.equal(claro.cuerpo.data.monto_total, 12);
});

test("motivo: obligatorio, existente y activo", async () => {
  const numero = entorno.agregarFactura(8);
  const items = [{ descripcion: "Producto A", cantidad: 1 }];
  const cajero = "cajero.prueba@tallersis.test";
  assert.equal((await entorno.post("/api/devoluciones", { factura_numero: numero, items, cajero })).status, 400);
  assert.equal((await entorno.post("/api/devoluciones", { factura_numero: numero, items, cajero, motivo_id: 999999 })).status, 422);
  assert.equal((await entorno.post("/api/devoluciones", { factura_numero: numero, items, cajero, motivo_id: motivoInactivoId })).status, 422);
  assert.equal((await entorno.post("/api/devoluciones", { factura_numero: numero, items, cajero, motivo_id: "abc" })).status, 422);
});

test("observaciones: maximo 300 caracteres", async () => {
  const numero = entorno.agregarFactura(9);
  const items = [{ descripcion: "Producto A", cantidad: 1 }];
  const justo = await entorno.post("/api/devoluciones", solicitud(numero, items, { observaciones: "x".repeat(300) }));
  assert.equal(justo.status, 201);
  const largo = await entorno.post("/api/devoluciones", solicitud(numero, items, { observaciones: "x".repeat(301) }));
  assert.equal(largo.status, 400);
  assert.match(largo.cuerpo.mensaje, /300 caracteres/);
  const vacio = await entorno.post("/api/devoluciones", solicitud(numero, items, { observaciones: "   " }));
  assert.equal(vacio.cuerpo.data.observaciones, null);
});

test("factura fuera de plazo, anulada o inexistente: no se puede registrar", async () => {
  const vieja = entorno.agregarFactura(10, { fecha: hace(9) });
  const fuera = await entorno.post("/api/devoluciones", solicitud(vieja, [{ descripcion: "Producto A", cantidad: 1 }]));
  assert.equal(fuera.status, 422);
  assert.equal(fuera.cuerpo.mensaje, "Fuera de plazo");
  assert.equal(fuera.cuerpo.detalle.codigo, "FUERA_DE_PLAZO");

  const anulada = entorno.agregarFactura(11, { estado: "Anulada" });
  const r = await entorno.post("/api/devoluciones", solicitud(anulada, [{ descripcion: "Producto A", cantidad: 1 }]));
  assert.equal(r.status, 422);
  assert.equal(r.cuerpo.detalle.codigo, "FACTURA_NO_VALIDA");

  const noExiste = await entorno.post("/api/devoluciones", solicitud(entorno.numero(99), [{ descripcion: "Producto A", cantidad: 1 }]));
  assert.equal(noExiste.status, 404);
});
