// TDSI-45: como se devuelve el dinero segun el metodo de pago original (EFECTIVO / REVERSION_TARJETA / REVERSION_QR).
const test = require("node:test");
const assert = require("node:assert/strict");
const { tipoDeReembolso, repartirMonto } = require("../utils/reembolso");
const { planificarReembolso } = require("../services/reembolsoService");
const { iniciarEntorno } = require("./helpers/entorno");

// ---------- funciones puras ----------
test("el tipo de reembolso sale del metodo: Efectivo, Tarjeta y QR; cualquier otro, ninguno", () => {
  assert.equal(tipoDeReembolso("Efectivo"), "EFECTIVO");
  assert.equal(tipoDeReembolso("Tarjeta"), "REVERSION_TARJETA");
  assert.equal(tipoDeReembolso("QR"), "REVERSION_QR");
  assert.equal(tipoDeReembolso("Cheque"), null);
  assert.equal(tipoDeReembolso(undefined), null);
});

test("repartirMonto: un solo metodo recibe todo", () => {
  assert.deepEqual(repartirMonto(45, [{ metodo: "QR", monto: 100 }]), [{ metodo: "QR", monto: 45 }]);
});

test("repartirMonto: pago mixto en proporcion, 20 efectivo + 80 QR con 45 a devolver -> 9 y 36", () => {
  assert.deepEqual(repartirMonto(45, [{ metodo: "Efectivo", monto: 20 }, { metodo: "QR", monto: 80 }]), [
    { metodo: "Efectivo", monto: 9 },
    { metodo: "QR", monto: 36 },
  ]);
});

test("repartirMonto: los centavos del redondeo van al ultimo, y la suma da SIEMPRE el monto exacto", () => {
  const partes = repartirMonto(10, [{ metodo: "Efectivo", monto: 1 }, { metodo: "Tarjeta", monto: 1 }, { metodo: "QR", monto: 1 }]);
  assert.deepEqual(partes.map((p) => p.monto), [3.33, 3.33, 3.34]);
  for (const monto of [0.01, 7.77, 100, 123.45, 999.99]) {
    const suma = repartirMonto(monto, [{ metodo: "Efectivo", monto: 33.3 }, { metodo: "Tarjeta", monto: 41.1 }, { metodo: "QR", monto: 25.6 }])
      .reduce((a, p) => a + p.monto, 0);
    assert.equal(Math.round(suma * 100), Math.round(monto * 100), `monto ${monto}`);
  }
});

const factura = (metodos_pago, canal = "Presencial") => ({ numero: "F-000099", canal, metodos_pago });

test("planificarReembolso: un metodo -> un reembolso del tipo que corresponde, con su descripcion", () => {
  const [efectivo] = planificarReembolso({ monto: 45, factura: factura([{ metodo: "Efectivo", monto: 100 }]) });
  assert.deepEqual([efectivo.tipo, efectivo.metodo, efectivo.monto], ["EFECTIVO", "Efectivo", 45]);
  assert.match(efectivo.descripcion, /Entregar Bs 45\.00 en efectivo al cliente/);

  const [tarjeta] = planificarReembolso({ monto: 45, factura: factura([{ metodo: "Tarjeta", monto: 100 }]) });
  assert.deepEqual([tarjeta.tipo, tarjeta.monto], ["REVERSION_TARJETA", 45]);
  assert.match(tarjeta.descripcion, /Revertir Bs 45\.00 del cobro con tarjeta/);

  const [qr] = planificarReembolso({ monto: 45, factura: factura([{ metodo: "QR", monto: 100 }]) });
  assert.deepEqual([qr.tipo, qr.monto], ["REVERSION_QR", 45]);
});

test("planificarReembolso: pago mixto -> un reembolso por metodo, repartido en proporcion", () => {
  const plan = planificarReembolso({ monto: 45, factura: factura([{ metodo: "Efectivo", monto: 20 }, { metodo: "QR", monto: 80 }]) });
  assert.deepEqual(plan.map((p) => [p.tipo, p.monto]), [["EFECTIVO", 9], ["REVERSION_QR", 36]]);
});

test("planificarReembolso: sin metodo de pago registrado -> 422", () => {
  assert.throws(() => planificarReembolso({ monto: 10, factura: factura([]) }), (e) => e.status === 422 && /no tiene método de pago/.test(e.message));
});

test("planificarReembolso: los pedidos del Marketplace (Online) nunca van a efectivo de caja -> 422; por tarjeta o QR si", () => {
  assert.throws(
    () => planificarReembolso({ monto: 10, factura: factura([{ metodo: "Efectivo", monto: 50 }], "Online") }),
    (e) => e.status === 422 && /Marketplace no se reembolsan con efectivo de caja/.test(e.message)
  );
  assert.throws(() => planificarReembolso({ monto: 10, factura: factura([{ metodo: "QR", monto: 30 }, { metodo: "Efectivo", monto: 20 }], "Online") }), (e) => e.status === 422);
  const [qr] = planificarReembolso({ monto: 10, factura: factura([{ metodo: "QR", monto: 50 }], "Online") });
  assert.equal(qr.tipo, "REVERSION_QR");
});

// ---------- por HTTP (base real, Facturacion simulado) ----------
let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.reembolso@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});

test.after(() => entorno.cerrar());

/** Registra una devolucion de `cantidad` de Producto A (10 Bs c/u) sobre una factura con esos metodos y canal. */
async function devolucion({ cantidad = 4, metodosPago, canal, aprobar = true } = {}) {
  const numero = entorno.agregarFactura(500 + ++contador, { metodosPago, canal });
  const { cuerpo } = await entorno.post("/api/devoluciones", {
    factura_numero: numero, items: [{ descripcion: "Producto A", cantidad, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: CAJERO,
  });
  const codigo = cuerpo.data.codigo;
  if (aprobar) await entorno.post(`/api/devoluciones/${codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  return { codigo, numero };
}

test("GET /:codigo/reembolso muestra como se devolvera el dinero segun el metodo original y el monto", async () => {
  const { codigo, numero } = await devolucion({ cantidad: 4, metodosPago: [{ metodo: "Efectivo", monto: 100 }] });
  const { status, cuerpo } = await entorno.get(`/api/devoluciones/${codigo}/reembolso`);
  assert.equal(status, 200);
  const d = cuerpo.data;
  assert.equal(d.codigo, codigo);
  assert.equal(d.monto_total, 40);
  assert.equal(d.factura_numero, numero);
  assert.equal(d.metodo_pago, "Efectivo");
  assert.equal(d.sale_efectivo_de_caja, true);
  assert.deepEqual(d.plan.map((p) => [p.tipo, p.monto]), [["EFECTIVO", 40]]);
});

test("tarjeta y QR: reversion del cobro, sin efectivo de caja", async () => {
  const t = await devolucion({ metodosPago: [{ metodo: "Tarjeta", monto: 100 }] });
  const rt = (await entorno.get(`/api/devoluciones/${t.codigo}/reembolso`)).cuerpo.data;
  assert.deepEqual(rt.plan.map((p) => p.tipo), ["REVERSION_TARJETA"]);
  assert.equal(rt.sale_efectivo_de_caja, false);

  const q = await devolucion({ metodosPago: [{ metodo: "QR", monto: 100 }] });
  assert.deepEqual((await entorno.get(`/api/devoluciones/${q.codigo}/reembolso`)).cuerpo.data.plan.map((p) => p.tipo), ["REVERSION_QR"]);
});

test("pago mixto por HTTP: un reembolso por metodo", async () => {
  const { codigo } = await devolucion({ cantidad: 5, metodosPago: [{ metodo: "Efectivo", monto: 20 }, { metodo: "QR", monto: 80 }] });
  const { cuerpo } = await entorno.get(`/api/devoluciones/${codigo}/reembolso`);
  assert.deepEqual(cuerpo.data.plan.map((p) => [p.tipo, p.monto]), [["EFECTIVO", 10], ["REVERSION_QR", 40]]);
});

test("pedido del Marketplace pagado en efectivo: 422, nunca sale efectivo de caja", async () => {
  const { codigo } = await devolucion({ metodosPago: [{ metodo: "Efectivo", monto: 100 }], canal: "Online" });
  const r = await entorno.get(`/api/devoluciones/${codigo}/reembolso`);
  assert.equal(r.status, 422);
  assert.match(r.cuerpo.mensaje, /Marketplace no se reembolsan con efectivo de caja/);
});

test("solo se reembolsan APROBADAS: pendiente o rechazada dan 409; codigo inexistente 404", async () => {
  const pendiente = await devolucion({ aprobar: false, metodosPago: [{ metodo: "QR", monto: 100 }] });
  const r1 = await entorno.get(`/api/devoluciones/${pendiente.codigo}/reembolso`);
  assert.equal(r1.status, 409);
  assert.match(r1.cuerpo.mensaje, /está PENDIENTE: solo se reembolsan las APROBADAS/);
  assert.equal((await entorno.get("/api/devoluciones/DEV-999999/reembolso")).status, 404);
});

test("la factura sin metodo de pago registrado no se puede reembolsar (422)", async () => {
  const { codigo } = await devolucion({ metodosPago: [] });
  const r = await entorno.get(`/api/devoluciones/${codigo}/reembolso`);
  assert.equal(r.status, 422);
  assert.match(r.cuerpo.mensaje, /no tiene método de pago/);
});
