// TDSI-116: las devoluciones con origen MARKETPLACE se reembolsan siempre por reversion del pago online, nunca con
// salida de efectivo de la caja. BD real; Facturacion simulado; Pub/Sub falso; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { planificarReembolso } = require("../services/reembolsoService");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.mkt@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});
test.after(() => entorno.cerrar());

const factura = (metodos_pago, canal = "Online") => ({ numero: "F-000099", canal, metodos_pago });

test("plan puro: un pedido online pagado en efectivo se revierte como pago online (QR), nunca EFECTIVO", () => {
  const [p] = planificarReembolso({ monto: 45, factura: factura([{ metodo: "Efectivo", monto: 100 }]), origen: "MARKETPLACE" });
  assert.deepEqual([p.tipo, p.metodo, p.monto], ["REVERSION_QR", "QR", 45]);
  assert.match(p.descripcion, /Revertir Bs 45\.00 del pago online.*no sale efectivo de la caja/);
});

test("plan puro: tarjeta y QR siguen siendo su propia reversion; el efectivo se suma al QR (un solo reembolso por tipo)", () => {
  assert.deepEqual(planificarReembolso({ monto: 30, factura: factura([{ metodo: "Tarjeta", monto: 100 }]), origen: "MARKETPLACE" }).map((x) => [x.tipo, x.monto]), [["REVERSION_TARJETA", 30]]);
  // 20 efectivo + 80 QR con 50 a devolver: 10 + 40 -> todo QR = 50 en UN solo reembolso
  assert.deepEqual(planificarReembolso({ monto: 50, factura: factura([{ metodo: "Efectivo", monto: 20 }, { metodo: "QR", monto: 80 }]), origen: "MARKETPLACE" }).map((x) => [x.tipo, x.monto]), [["REVERSION_QR", 50]]);
  // 20 efectivo + 40 tarjeta + 40 QR con 100: 20 + 40 + 40 -> QR 60 y tarjeta 40
  const plan = planificarReembolso({ monto: 100, factura: factura([{ metodo: "Efectivo", monto: 20 }, { metodo: "Tarjeta", monto: 40 }, { metodo: "QR", monto: 40 }]), origen: "MARKETPLACE" });
  assert.deepEqual(plan.map((x) => [x.tipo, x.monto]).sort(), [["REVERSION_QR", 60], ["REVERSION_TARJETA", 40]].sort());
  assert.equal(plan.reduce((a, x) => a + x.monto, 0), 100);
});

test("plan puro: lo de la TIENDA no cambia (un pedido Online pagado en efectivo sin origen MARKETPLACE sigue dando 422)", () => {
  assert.throws(() => planificarReembolso({ monto: 10, factura: factura([{ metodo: "Efectivo", monto: 50 }]) }), (e) => e.status === 422);
  assert.equal(planificarReembolso({ monto: 10, factura: factura([{ metodo: "Efectivo", monto: 50 }], "Presencial") })[0].tipo, "EFECTIVO");
  assert.throws(() => planificarReembolso({ monto: 10, factura: factura([]), origen: "MARKETPLACE" }), (e) => e.status === 422); // sin metodo de pago sigue sin saberse como devolver
});

async function marketplaceAprobada(metodosPago) {
  const numero = entorno.agregarFactura(150 + ++contador, { canal: "Online", metodosPago });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 4, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: "MARKETPLACE" });
  const codigo = cuerpo.data.codigo;
  await query(`UPDATE devoluciones.devoluciones SET origen = 'MARKETPLACE', orden_id = $2 WHERE codigo = $1`, [codigo, `ORD-${codigo}`]);
  await entorno.post(`/api/devoluciones/${codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  return codigo;
}

test("GET /reembolso de una devolucion del Marketplace pagada en efectivo muestra una reversion y NO sale efectivo de la caja", async () => {
  const codigo = await marketplaceAprobada([{ metodo: "Efectivo", monto: 100 }]);
  const r = await entorno.get(`/api/devoluciones/${codigo}/reembolso`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.cuerpo.data.plan.map((p) => [p.tipo, p.monto]), [["REVERSION_QR", 40]]);
  assert.equal(r.cuerpo.data.sale_efectivo_de_caja, false);
});

test("reembolsar: no pide caja ni turno, no toca la Caja (aunque este caida) y la reversion se envia a la pasarela", async () => {
  const codigo = await marketplaceAprobada([{ metodo: "Efectivo", monto: 100 }]);
  const url = process.env.GESTION_CAJA_URL;
  process.env.GESTION_CAJA_URL = "http://localhost:1"; // si se tocara la caja, daria 503
  try {
    const r = await entorno.post(`/api/devoluciones/${codigo}/reembolsar`, { cajero: CAJERO }); // sin caja_id
    assert.equal(r.status, 201);
    assert.deepEqual(r.cuerpo.data.reembolsos.map((x) => [x.tipo, x.monto, x.estado]), [["REVERSION_QR", 40, "PROCESADO"]]);
    assert.match(r.cuerpo.mensaje, /^Reversión enviada: Bs 40\.00 del cobro con QR$/);
    assert.equal(r.cuerpo.data.estado, "PROCESADA");
  } finally {
    process.env.GESTION_CAJA_URL = url;
  }
  const { rows } = await query(`SELECT count(*)::int n FROM devoluciones.reembolsos r JOIN devoluciones.devoluciones d ON d.id = r.devolucion_id WHERE d.codigo = $1 AND r.tipo = 'EFECTIVO'`, [codigo]);
  assert.equal(rows[0].n, 0);
});

test("la devolucion de la tienda pagada en efectivo sigue pidiendo la caja (no se afecto)", async () => {
  const numero = entorno.agregarFactura(150 + ++contador, { metodosPago: [{ metodo: "Efectivo", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: CAJERO });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  const r = await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/reembolsar`, { cajero: CAJERO });
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.mensaje, /Falta la caja/);
});
