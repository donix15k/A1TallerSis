// TDSI-48: reembolsos guardados en la base real y reversiones de tarjeta/QR enviadas a la pasarela con reintentos.
// La pasarela es un servidor HTTP local (llamadas HTTP de verdad); la base es la real y se limpia al terminar.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { query } = require("../config/db");
const repo = require("../data/reembolsosRepo");
const { procesarPendientes, esperaTras } = require("../services/reversionService");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
let pasarela;
let recibidas;
let respuesta; // status HTTP que devuelve la pasarela

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  pasarela = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      recibidas.push({ metodo: req.method, url: req.url, cuerpo: JSON.parse(cuerpo || "{}") });
      res.statusCode = respuesta;
      res.end("{}");
    });
  });
  await new Promise((r) => pasarela.listen(0, r));
  process.env.PASARELA_URL = `http://localhost:${pasarela.address().port}`;
});

test.beforeEach(() => {
  recibidas = [];
  respuesta = 200;
  process.env.PASARELA_MAX_INTENTOS = "3";
  process.env.PASARELA_ESPERA_SEG = "30";
});

test.after(async () => {
  delete process.env.PASARELA_URL;
  pasarela.closeAllConnections();
  await new Promise((r) => pasarela.close(r));
  await entorno.cerrar();
});

/** Registra una devolucion y guarda los reembolsos del plan, como lo hara el endpoint de reembolsar. */
async function conReembolsos(plan) {
  const numero = entorno.agregarFactura(700 + ++contador, {});
  const { cuerpo } = await entorno.post("/api/devoluciones", {
    factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1 }], motivo_id: motivoId, cajero: "cajero.pasarela@tallersis.test",
  });
  const codigo = cuerpo.data.codigo;
  const { rows } = await query(`SELECT id FROM devoluciones.devoluciones WHERE codigo = $1`, [codigo]);
  const id = Number(rows[0].id);
  const guardados = await repo.withTransaction((client) => repo.guardarReembolsos(client, id, plan));
  return { codigo, id, guardados };
}

const estadoEnvio = async (reembolsoId) =>
  (await query(`SELECT e.estado, e.intentos, e.ultimo_error, e.proximo_intento_en, e.enviado_en, r.estado AS reembolso FROM devoluciones.envios_pasarela e JOIN devoluciones.reembolsos r ON r.id = e.reembolso_id WHERE r.id = $1`, [reembolsoId])).rows[0];

/** Hace que al envio "ya le toque" (en la vida real pasa con el tiempo). */
const vencer = (reembolsoId) => query(`UPDATE devoluciones.envios_pasarela SET proximo_intento_en = now() - interval '1 second' WHERE reembolso_id = $1`, [reembolsoId]);

test("el reembolso en efectivo se guarda PROCESADO y sin envio; tarjeta y QR quedan PENDIENTE con su envio a la pasarela", async () => {
  const { guardados, id } = await conReembolsos([
    { tipo: "EFECTIVO", monto: 9 }, { tipo: "REVERSION_TARJETA", monto: 20 }, { tipo: "REVERSION_QR", monto: 16 },
  ]);
  const [ef, tj, qr] = guardados;
  assert.deepEqual([ef.estado, ef.envio_id], ["PROCESADO", null]);
  assert.ok(ef.procesado_en);
  assert.deepEqual([tj.estado, qr.estado], ["PENDIENTE", "PENDIENTE"]);
  assert.ok(tj.envio_id && qr.envio_id);

  const lista = await repo.listarPorDevolucion(id);
  assert.deepEqual(lista.map((r) => [r.tipo, r.monto, r.estado]), [["EFECTIVO", 9, "PROCESADO"], ["REVERSION_TARJETA", 20, "PENDIENTE"], ["REVERSION_QR", 16, "PENDIENTE"]]);
  assert.deepEqual([lista[1].envio.estado, lista[1].envio.intentos, lista[1].envio.pasarela], ["PENDIENTE", 0, "Pasarela de tarjetas"]);
  assert.equal(lista[2].envio.pasarela, "Pasarela QR");
  assert.equal(lista[0].envio, null);
});

test("no se puede guardar dos veces el mismo tipo de reembolso de una devolucion", async () => {
  const { id } = await conReembolsos([{ tipo: "EFECTIVO", monto: 5 }]);
  await assert.rejects(repo.withTransaction((client) => repo.guardarReembolsos(client, id, [{ tipo: "EFECTIVO", monto: 5 }])), /uq_reembolsos_devolucion_tipo/);
});

test("si la transaccion falla, no queda ningun reembolso a medias", async () => {
  const { id } = await conReembolsos([{ tipo: "EFECTIVO", monto: 5 }]);
  await assert.rejects(repo.withTransaction(async (client) => {
    await repo.guardarReembolsos(client, id, [{ tipo: "REVERSION_QR", monto: 7 }]);
    throw new Error("falla despues de guardar");
  }), /falla despues/);
  assert.deepEqual((await repo.listarPorDevolucion(id)).map((r) => r.tipo), ["EFECTIVO"]);
});

test("la pasarela acepta: el envio queda ENVIADO (1 intento), el reembolso PROCESADO, y recibe tipo, monto y codigo", async () => {
  const { guardados, codigo } = await conReembolsos([{ tipo: "REVERSION_TARJETA", monto: 20 }]);
  const resumen = await procesarPendientes({ reembolsoIds: [guardados[0].id] });
  assert.deepEqual(resumen, { enviados: 1, fallidos: 0, agotados: 0 });
  assert.equal(recibidas.length, 1);
  assert.equal(recibidas[0].url, "/reversiones");
  assert.deepEqual(recibidas[0].cuerpo, { tipo: "REVERSION_TARJETA", monto: 20, referencia: codigo, reembolso_id: guardados[0].id });
  const e = await estadoEnvio(guardados[0].id);
  assert.deepEqual([e.estado, e.intentos, e.reembolso], ["ENVIADO", 1, "PROCESADO"]);
  assert.ok(e.enviado_en);

  // ya enviado: otra pasada no lo manda de nuevo
  assert.deepEqual(await procesarPendientes({ reembolsoIds: [guardados[0].id] }), { enviados: 0, fallidos: 0, agotados: 0 });
  assert.equal(recibidas.length, 1);
});

test("la pasarela falla: sigue PENDIENTE con el error y la hora del reintento; no se reintenta antes de tiempo", async () => {
  const { guardados } = await conReembolsos([{ tipo: "REVERSION_QR", monto: 16 }]);
  respuesta = 500;
  assert.deepEqual(await procesarPendientes({ reembolsoIds: [guardados[0].id] }), { enviados: 0, fallidos: 1, agotados: 0 });
  const e = await estadoEnvio(guardados[0].id);
  assert.deepEqual([e.estado, e.intentos, e.reembolso], ["PENDIENTE", 1, "PENDIENTE"]);
  assert.match(e.ultimo_error, /rechazó la reversión \(HTTP 500\)/);
  assert.ok(new Date(e.proximo_intento_en) > new Date());

  // todavia no le toca: no se llama a la pasarela
  respuesta = 200;
  assert.deepEqual(await procesarPendientes({ reembolsoIds: [guardados[0].id] }), { enviados: 0, fallidos: 0, agotados: 0 });
  assert.equal(recibidas.length, 1);

  // cuando le toca, se reintenta y esta vez la pasarela acepta
  await vencer(guardados[0].id);
  assert.deepEqual(await procesarPendientes({ reembolsoIds: [guardados[0].id] }), { enviados: 1, fallidos: 0, agotados: 0 });
  const f = await estadoEnvio(guardados[0].id);
  assert.deepEqual([f.estado, f.intentos, f.reembolso, f.ultimo_error], ["ENVIADO", 2, "PROCESADO", null]);
});

test("al agotar los intentos (3) el envio y el reembolso quedan en ERROR y ya no se reintenta", async () => {
  const { guardados } = await conReembolsos([{ tipo: "REVERSION_TARJETA", monto: 12 }]);
  respuesta = 503;
  const ids = [guardados[0].id];
  assert.deepEqual(await procesarPendientes({ reembolsoIds: ids }), { enviados: 0, fallidos: 1, agotados: 0 });
  await vencer(ids[0]);
  assert.deepEqual(await procesarPendientes({ reembolsoIds: ids }), { enviados: 0, fallidos: 1, agotados: 0 });
  await vencer(ids[0]);
  assert.deepEqual(await procesarPendientes({ reembolsoIds: ids }), { enviados: 0, fallidos: 1, agotados: 1 });

  const e = await estadoEnvio(ids[0]);
  assert.deepEqual([e.estado, e.intentos, e.reembolso, e.proximo_intento_en], ["ERROR", 3, "ERROR", null]);
  assert.equal(recibidas.length, 3);
  respuesta = 200;
  assert.deepEqual(await procesarPendientes({ reembolsoIds: ids }), { enviados: 0, fallidos: 0, agotados: 0 });
  assert.equal(recibidas.length, 3);
});

test("pasarela caida: es un fallo mas (se reintentara), no rompe el proceso", async () => {
  const { guardados } = await conReembolsos([{ tipo: "REVERSION_QR", monto: 3 }]);
  const url = process.env.PASARELA_URL;
  process.env.PASARELA_URL = "http://localhost:1";
  try {
    assert.deepEqual(await procesarPendientes({ reembolsoIds: [guardados[0].id] }), { enviados: 0, fallidos: 1, agotados: 0 });
  } finally {
    process.env.PASARELA_URL = url;
  }
  assert.match((await estadoEnvio(guardados[0].id)).ultimo_error, /No se pudo conectar con la pasarela/);
});

test("dos procesos a la vez: el mismo envio se manda UNA sola vez", async () => {
  const { guardados } = await conReembolsos([{ tipo: "REVERSION_TARJETA", monto: 8 }]);
  const ids = [guardados[0].id];
  const [a, b] = await Promise.all([procesarPendientes({ reembolsoIds: ids }), procesarPendientes({ reembolsoIds: ids })]);
  assert.equal(a.enviados + b.enviados, 1);
  assert.equal(recibidas.length, 1);
});

test("sin PASARELA_URL la pasarela es simulada y acepta la reversion", async () => {
  const { guardados } = await conReembolsos([{ tipo: "REVERSION_QR", monto: 4 }]);
  const url = process.env.PASARELA_URL;
  delete process.env.PASARELA_URL;
  try {
    assert.deepEqual(await procesarPendientes({ reembolsoIds: [guardados[0].id] }), { enviados: 1, fallidos: 0, agotados: 0 });
  } finally {
    process.env.PASARELA_URL = url;
  }
  assert.equal(recibidas.length, 0);
});

test("la espera entre reintentos se duplica en cada fallo (30 s, 60 s, 120 s) con tope de 1 hora", () => {
  assert.deepEqual([1, 2, 3, 4].map(esperaTras), [30, 60, 120, 240]);
  assert.equal(esperaTras(20), 3600);
});
