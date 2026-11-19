// TDSI-71: POST /api/vales/:codigo/usar, revertir-uso y la tarea que marca los vencidos. BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { expirarVencidos } = require("../services/valeService");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.uso@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});
test.after(() => entorno.cerrar());

/** Vale de `cantidad` x 10 Bs (por defecto 80 Bs). */
async function vale(cantidad = 8) {
  const numero = entorno.agregarFactura(400 + ++contador, { items: [{ descripcion: "Producto A", cantidad: "20.00", precio_unitario: "10.00", subtotal: "200.00" }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: CAJERO });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  return (await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/reembolsar`, { cajero: CAJERO, forma: "VALE" })).cuerpo.data.vale.codigo;
}
const usar = (codigo, cuerpo) => entorno.post(`/api/vales/${codigo}/usar`, cuerpo);
const saldo = async (codigo) => (await entorno.get(`/api/vales/${codigo}`)).cuerpo.data;

test("usar 50 Bs de un vale de 80: queda con 30 Bs y sigue ACTIVO", async () => {
  const c = await vale(8);
  const r = await usar(c, { monto: 50, referencia: "T-1" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.cuerpo.data.monto_usado, r.cuerpo.data.saldo_disponible, r.cuerpo.data.estado, r.cuerpo.data.duplicado], [50, 30, "ACTIVO", false]);
  assert.deepEqual([(await saldo(c)).saldo_disponible, (await saldo(c)).estado], [30, "ACTIVO"]);
});

test("al llegar el saldo a 0 el vale queda USADO y ya no se puede usar", async () => {
  const c = await vale(3);
  await usar(c, { monto: 10, referencia: "A" });
  const r = await usar(c, { monto: 20, referencia: "B" });
  assert.deepEqual([r.cuerpo.data.saldo_disponible, r.cuerpo.data.estado], [0, "USADO"]);
  const otra = await usar(c, { monto: 1, referencia: "C" });
  assert.equal(otra.status, 409);
  assert.equal(otra.cuerpo.mensaje, "El vale no tiene saldo disponible");
});

test("un monto mayor al saldo da 409 con el saldo disponible y NO descuenta nada", async () => {
  const c = await vale(3);
  const r = await usar(c, { monto: 30.01, referencia: "X" });
  assert.equal(r.status, 409);
  assert.match(r.cuerpo.mensaje, /solo tiene Bs 30\.00 de saldo disponible/);
  assert.equal(r.cuerpo.detalle.saldo_disponible, 30);
  assert.equal((await saldo(c)).saldo_disponible, 30);
});

test("un vale vencido no se puede usar aunque la tarea no lo haya marcado todavia", async () => {
  const c = await vale(3);
  await query(`UPDATE devoluciones.vales_compra SET expira_en = now() - interval '1 hour' WHERE codigo = $1`, [c]);
  const r = await usar(c, { monto: 5, referencia: "V" });
  assert.equal(r.status, 409);
  assert.equal(r.cuerpo.mensaje, "El vale no tiene saldo disponible");
});

test("repetir el MISMO cobro (misma referencia) no descuenta dos veces", async () => {
  const c = await vale(8);
  await usar(c, { monto: 50, referencia: "COBRO-9" });
  const otra = await usar(c, { monto: 50, referencia: "COBRO-9" });
  assert.equal(otra.status, 200);
  assert.equal(otra.cuerpo.data.duplicado, true);
  assert.equal((await saldo(c)).saldo_disponible, 30);
});

test("dos cobros a la vez que juntos pasan el saldo: solo uno se aplica (no se gasta de mas)", async () => {
  const c = await vale(8); // 80
  const [a, b] = await Promise.all([usar(c, { monto: 50, referencia: "P1" }), usar(c, { monto: 50, referencia: "P2" })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal((await saldo(c)).saldo_disponible, 30);
});

test("validaciones: monto <= 0, no numerico, con 3 decimales, sin referencia; codigo inexistente 404", async () => {
  const c = await vale(2);
  for (const monto of [0, -5, "abc", null, undefined, 1.234]) assert.equal((await usar(c, { monto, referencia: "R" })).status, 400, String(monto));
  assert.equal((await usar(c, { monto: 5 })).status, 400);
  assert.equal((await usar("VAL-ZZZZZZ", { monto: 5, referencia: "R" })).status, 404);
  assert.equal((await usar("nada", { monto: 5, referencia: "R" })).status, 400);
  assert.equal((await saldo(c)).saldo_disponible, 20);
});

test("revertir-uso devuelve el saldo y reactiva el vale USADO; no se puede revertir dos veces", async () => {
  const c = await vale(3);
  await usar(c, { monto: 30, referencia: "REV" });
  assert.equal((await saldo(c)).estado, "USADO");
  const r = await entorno.post(`/api/vales/${c}/revertir-uso`, { referencia: "REV" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.cuerpo.data.monto_devuelto, r.cuerpo.data.saldo_disponible, r.cuerpo.data.estado], [30, 30, "ACTIVO"]);
  assert.equal((await entorno.post(`/api/vales/${c}/revertir-uso`, { referencia: "REV" })).status, 404);
  assert.equal((await usar(c, { monto: 30, referencia: "REV" })).status, 200); // la referencia se puede volver a usar
});

test("la tarea diaria marca EXPIRADO solo los vales ACTIVOS ya vencidos", async () => {
  const vencido = await vale(1);
  const vigente = await vale(1);
  await query(`UPDATE devoluciones.vales_compra SET expira_en = now() - interval '2 days' WHERE codigo = $1`, [vencido]);
  const n = await expirarVencidos();
  assert.ok(n >= 1);
  const estado = async (c) => (await query(`SELECT estado FROM devoluciones.vales_compra WHERE codigo = $1`, [c])).rows[0].estado;
  assert.equal(await estado(vencido), "EXPIRADO");
  assert.equal(await estado(vigente), "ACTIVO");
  assert.equal(await expirarVencidos(), 0); // idempotente
});
