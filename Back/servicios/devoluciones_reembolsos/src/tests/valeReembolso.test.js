// TDSI-68: reembolsar con un VALE de compra (en vez de dinero). BD real, Facturacion simulado; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { codigoAleatorio } = require("../data/valesRepo");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.vale@tallersis.test";
const FORMATO = /^VAL-[A-HJ-KM-NP-Z2-9]{6}$/;

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});
test.after(() => entorno.cerrar());

async function aprobada({ cantidad = 8, metodosPago = [{ metodo: "Efectivo", monto: 100 }], canal } = {}) {
  const numero = entorno.agregarFactura(600 + ++contador, { metodosPago, canal, items: [{ descripcion: "Producto A", cantidad: "20.00", precio_unitario: "10.00", subtotal: "200.00" }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad }], motivo_id: motivoId, cajero: CAJERO });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  return cuerpo.data.codigo;
}
const reembolsarVale = (codigo, extra = {}) => entorno.post(`/api/devoluciones/${codigo}/reembolsar`, { cajero: CAJERO, forma: "VALE", ...extra });

test("el codigo es VAL-XXXXXX sin caracteres confusos (sin 0, O, 1, I, L)", () => {
  for (let i = 0; i < 500; i++) assert.match(codigoAleatorio(), FORMATO);
});

test("reembolsar en VALE: devolucion PROCESADA, vale ACTIVO con saldo = monto (80 Bs) y vencimiento a 90 dias", async () => {
  const codigo = await aprobada({ cantidad: 8 });
  const r = await reembolsarVale(codigo);
  assert.equal(r.status, 201);
  const v = r.cuerpo.data.vale;
  assert.match(v.codigo, FORMATO);
  assert.deepEqual([v.monto, v.saldo_disponible, v.estado], [80, 80, "ACTIVO"]);
  assert.equal(r.cuerpo.data.estado, "PROCESADA");
  assert.deepEqual(r.cuerpo.data.reembolsos.map((x) => [x.tipo, x.monto, x.estado, x.envio]), [["VALE", 80, "PROCESADO", null]]);
  assert.match(r.cuerpo.mensaje, new RegExp(`Vale ${v.codigo} por Bs 80\\.00 emitido`));
  assert.ok(r.cuerpo.data.nota_credito.numero); // igual se emite su nota de credito

  const { rows } = await query(`SELECT extract(epoch FROM (expira_en - emitido_en)) / 86400 AS dias FROM devoluciones.vales_compra WHERE codigo = $1`, [v.codigo]);
  assert.equal(Math.round(Number(rows[0].dias)), 90);
});

test("un vale no genera salida de efectivo: no hace falta caja_id ni turno (Caja ni se consulta)", async () => {
  const codigo = await aprobada({ metodosPago: [{ metodo: "Efectivo", monto: 100 }] });
  const url = process.env.GESTION_CAJA_URL;
  process.env.GESTION_CAJA_URL = "http://localhost:1"; // si se tocara la caja, daria 503
  try {
    assert.equal((await reembolsarVale(codigo)).status, 201);
  } finally {
    process.env.GESTION_CAJA_URL = url;
  }
});

test("el pedido del Marketplace pagado en efectivo SI se puede devolver en vale (no sale efectivo de caja)", async () => {
  const codigo = await aprobada({ metodosPago: [{ metodo: "Efectivo", monto: 100 }], canal: "Online" });
  assert.equal((await entorno.post(`/api/devoluciones/${codigo}/reembolsar`, { cajero: CAJERO })).status, 422); // por defecto no
  assert.equal((await reembolsarVale(codigo)).status, 201);
});

test("una devolucion solo se reembolsa una vez: tampoco se puede dar un segundo vale (409)", async () => {
  const codigo = await aprobada();
  assert.equal((await reembolsarVale(codigo)).status, 201);
  assert.equal((await reembolsarVale(codigo)).status, 409);
  assert.equal((await entorno.post(`/api/devoluciones/${codigo}/reembolsar`, { cajero: CAJERO, caja_id: "CAJA-01" })).status, 409);
  const { rows } = await query(`SELECT count(*)::int n FROM devoluciones.vales_compra v JOIN devoluciones.devoluciones d ON d.id = v.devolucion_id WHERE d.codigo = $1`, [codigo]);
  assert.equal(rows[0].n, 1);
});

test("forma invalida: 400 y la devolucion sigue APROBADA", async () => {
  const codigo = await aprobada();
  const r = await entorno.post(`/api/devoluciones/${codigo}/reembolsar`, { cajero: CAJERO, forma: "CRIPTO" });
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.mensaje, /ORIGINAL o VALE/);
  assert.equal((await entorno.get(`/api/devoluciones/${codigo}`)).cuerpo.data.estado, "APROBADA");
});

test("GET /reembolso ofrece las formas y con ?forma=VALE muestra el plan del vale", async () => {
  const codigo = await aprobada({ cantidad: 3, metodosPago: [{ metodo: "QR", monto: 100 }] });
  const normal = (await entorno.get(`/api/devoluciones/${codigo}/reembolso`)).cuerpo.data;
  assert.deepEqual(normal.formas_disponibles, ["ORIGINAL", "VALE"]);
  assert.deepEqual(normal.plan.map((p) => p.tipo), ["REVERSION_QR"]);
  const vale = (await entorno.get(`/api/devoluciones/${codigo}/reembolso?forma=VALE`)).cuerpo.data;
  assert.equal(vale.forma, "VALE");
  assert.deepEqual(vale.plan.map((p) => [p.tipo, p.monto]), [["VALE", 30]]);
  assert.equal(vale.sale_efectivo_de_caja, false);
  assert.equal((await entorno.get(`/api/devoluciones/${codigo}/reembolso?forma=X`)).status, 400);
});
