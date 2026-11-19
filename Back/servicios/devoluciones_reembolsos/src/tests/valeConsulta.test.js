// TDSI-69: GET /api/vales/:codigo. BD real, Facturacion simulado; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { estadoVigente } = require("../services/valeService");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.consulta@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});
test.after(() => entorno.cerrar());

async function vale(cantidad = 8) {
  const numero = entorno.agregarFactura(500 + ++contador, { items: [{ descripcion: "Producto A", cantidad: "20.00", precio_unitario: "10.00", subtotal: "200.00" }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad }], motivo_id: motivoId, cajero: CAJERO });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  return (await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/reembolsar`, { cajero: CAJERO, forma: "VALE" })).cuerpo.data.vale;
}
const consultar = (codigo) => entorno.get(`/api/vales/${encodeURIComponent(codigo)}`);

test("un vale recien emitido: ACTIVO con su saldo y su fecha de vencimiento", async () => {
  const v = await vale(8);
  const r = await consultar(v.codigo);
  assert.equal(r.status, 200);
  const d = r.cuerpo.data;
  assert.deepEqual([d.codigo, d.estado, d.monto, d.saldo_disponible, d.utilizable], [v.codigo, "ACTIVO", 80, 80, true]);
  assert.equal(new Date(d.vence_en).toISOString(), new Date(v.expira_en).toISOString());
  assert.match(d.mensaje, /saldo disponible de Bs 80\.00/);
});

test("el codigo se acepta en minusculas y con espacios (se escribe a mano en caja)", async () => {
  const v = await vale(2);
  assert.equal((await consultar(`  ${v.codigo.toLowerCase()} `)).status, 200);
});

test("vale usado (saldo 0): estado USADO, sin saldo y no utilizable", async () => {
  const v = await vale(3);
  await query(`UPDATE devoluciones.vales_compra SET saldo_disponible = 0 WHERE codigo = $1`, [v.codigo]);
  const d = (await consultar(v.codigo)).cuerpo.data;
  assert.deepEqual([d.estado, d.saldo_disponible, d.utilizable], ["USADO", 0, false]);
  assert.match(d.mensaje, /no tiene saldo disponible/);
});

test("vale vencido: EXPIRADO aunque la tarea diaria aun no lo haya marcado", async () => {
  const v = await vale(3);
  await query(`UPDATE devoluciones.vales_compra SET expira_en = now() - interval '1 day' WHERE codigo = $1`, [v.codigo]);
  const d = (await consultar(v.codigo)).cuerpo.data;
  assert.deepEqual([d.estado, d.saldo_disponible, d.saldo_guardado, d.utilizable], ["EXPIRADO", 0, 30, false]);
  assert.match(d.mensaje, /vencido/);
});

test("codigo inexistente: 404; codigo con formato invalido: 400", async () => {
  assert.equal((await consultar("VAL-ZZZZZZ")).status, 404);
  assert.equal((await consultar("ABC")).status, 400);
  assert.equal((await consultar("VAL-")).status, 400);
});

test("estadoVigente: reglas puras", () => {
  const ahora = new Date("2026-01-10T00:00:00Z");
  const base = { saldo_disponible: 50, expira_en: "2026-02-01T00:00:00Z" };
  assert.equal(estadoVigente({ ...base, estado: "ACTIVO" }, ahora), "ACTIVO");
  assert.equal(estadoVigente({ ...base, estado: "ACTIVO", saldo_disponible: 0 }, ahora), "USADO");
  assert.equal(estadoVigente({ ...base, estado: "ACTIVO", expira_en: "2026-01-09T00:00:00Z" }, ahora), "EXPIRADO");
  assert.equal(estadoVigente({ ...base, estado: "USADO" }, ahora), "USADO");
  assert.equal(estadoVigente({ ...base, estado: "EXPIRADO" }, ahora), "EXPIRADO");
});
