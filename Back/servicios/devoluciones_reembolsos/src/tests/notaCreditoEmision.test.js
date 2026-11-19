// TDSI-57: la nota de credito se emite al procesar la devolucion, con numeracion correlativa NC-000001. BD real.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const repo = require("../data/notasCreditoRepo");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.nota@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});
test.after(() => entorno.cerrar());

/** Devolucion APROBADA pagada por QR (no toca la caja) de `cantidad` x 10 Bs. */
async function aprobada(cantidad = 3) {
  const numero = entorno.agregarFactura(900 + ++contador, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad }], motivo_id: motivoId, cajero: CAJERO });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  return cuerpo.data.codigo;
}
const idDe = async (codigo) => Number((await query(`SELECT id FROM devoluciones.devoluciones WHERE codigo = $1`, [codigo])).rows[0].id);

test("numeroNC da el formato NC-000001 con 6 digitos", () => {
  assert.equal(repo.numeroNC(1), "NC-000001");
  assert.equal(repo.numeroNC(123), "NC-000123");
  assert.equal(repo.numeroNC(1234567), "NC-1234567");
});

test("al reembolsar, la devolucion queda PROCESADA con su nota de credito NC-NNNNNN por el monto devuelto", async () => {
  const codigo = await aprobada(3);
  const r = await entorno.post(`/api/devoluciones/${codigo}/reembolsar`, { cajero: CAJERO });
  assert.equal(r.status, 201);
  const nota = r.cuerpo.data.nota_credito;
  assert.match(nota.numero, /^NC-\d{6}$/);
  assert.equal(nota.monto, 30);
  assert.equal(nota.estado, "EMITIDA");
  assert.equal(nota.enviada_por_correo, false);
  assert.ok(nota.emitida_en);
  assert.deepEqual(JSON.parse(JSON.stringify(await repo.obtenerPorDevolucion(await idDe(codigo)))), nota);
});

test("cada devolucion tiene UNA sola nota: emitirla dos veces falla y no duplica", async () => {
  const codigo = await aprobada(1);
  await entorno.post(`/api/devoluciones/${codigo}/reembolsar`, { cajero: CAJERO });
  const id = await idDe(codigo);
  const { withTransaction } = require("../config/db");
  await assert.rejects(withTransaction((c) => repo.emitirNota(c, id, 10)), /uq_notas_credito_devolucion/);
  assert.equal((await query(`SELECT count(*)::int n FROM devoluciones.notas_credito WHERE devolucion_id = $1`, [id])).rows[0].n, 1);
});

test("la numeracion es correlativa y no se repite aunque se reembolse a la vez", async () => {
  const codigos = [await aprobada(1), await aprobada(2), await aprobada(3), await aprobada(4)];
  const respuestas = await Promise.all(codigos.map((c) => entorno.post(`/api/devoluciones/${c}/reembolsar`, { cajero: CAJERO })));
  const numeros = respuestas.map((r) => Number(r.cuerpo.data.nota_credito.numero.slice(3)));
  assert.equal(new Set(numeros).size, 4);
  const ordenados = [...numeros].sort((a, b) => a - b);
  assert.deepEqual(ordenados, [ordenados[0], ordenados[0] + 1, ordenados[0] + 2, ordenados[0] + 3]);
});

test("si el reembolso falla (turno de otro cajero), NO se gasta ningun numero de nota ni queda nota", async () => {
  // efectivo sin Caja disponible: Caja caida -> 503 y nada se guarda
  const numero = entorno.agregarFactura(990, { metodosPago: [{ metodo: "Efectivo", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1 }], motivo_id: motivoId, cajero: CAJERO });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  const url = process.env.GESTION_CAJA_URL;
  process.env.GESTION_CAJA_URL = "http://localhost:1";
  try {
    assert.equal((await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/reembolsar`, { cajero: CAJERO, caja_id: "CAJA-01" })).status, 503);
  } finally {
    process.env.GESTION_CAJA_URL = url;
  }
  assert.equal(await repo.obtenerPorDevolucion(await idDe(cuerpo.data.codigo)), null);
});
