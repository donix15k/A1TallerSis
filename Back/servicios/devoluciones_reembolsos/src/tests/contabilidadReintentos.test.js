// TDSI-93: reintentos automaticos de los envios a Contabilidad (cada 60 s, espera creciente, maximo 5 intentos).
// Pub/Sub FALSO (nunca se publica de verdad); BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const cfg = require("../config/contabilidad");
const repo = require("../data/enviosContabilidadRepo");
const { reintentarPendientes, iniciar } = require("../jobs/reintentoEnviosContabilidad");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.reintento@tallersis.test";
const RED = () => Object.assign(new Error("UNAVAILABLE"), { code: 14 });

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});
test.beforeEach(() => {
  entorno.pubsub.publicados.length = 0;
  entorno.pubsub.falla = null;
});
test.after(() => entorno.cerrar());

/** Procesa una devolucion con Pub/Sub caido: su envio a Contabilidad queda Pendiente (intento 1 fallido). */
async function conEnvioPendiente() {
  const numero = entorno.agregarFactura(80 + ++contador, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: CAJERO });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  entorno.pubsub.falla = RED();
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/reembolsar`, { cajero: CAJERO });
  return cuerpo.data.codigo;
}
const envioDe = (codigo) => repo.obtenerPorDevolucionCodigo(codigo);
/** Hace que "ya le toque" a este envio (en la vida real pasa con el tiempo). */
const vencer = (codigo) => query(
  `UPDATE devoluciones.envios_contabilidad_nc SET proximo_intento_en = now() - interval '1 second'
    WHERE nota_credito_id = (SELECT n.id FROM devoluciones.notas_credito n JOIN devoluciones.devoluciones d ON d.id = n.devolucion_id WHERE d.codigo = $1) AND estado = 'Pendiente'`,
  [codigo]
);
const segundosHastaProximo = async (codigo) => {
  const { rows } = await query(
    `SELECT extract(epoch FROM (e.proximo_intento_en - e.ultimo_intento_en)) AS s FROM devoluciones.envios_contabilidad_nc e JOIN devoluciones.notas_credito n ON n.id = e.nota_credito_id JOIN devoluciones.devoluciones d ON d.id = n.devolucion_id WHERE d.codigo = $1`,
    [codigo]
  );
  return Math.round(Number(rows[0].s));
};

test("el reintento publica el envio pendiente cuando ya le toca: queda Enviado con su messageId (2 intentos en total)", async () => {
  const codigo = await conEnvioPendiente();
  assert.equal((await envioDe(codigo)).estado, "Pendiente");
  await vencer(codigo);
  entorno.pubsub.falla = null;
  const r = await reintentarPendientes();
  const mio = r.find((x) => x.estado === "Enviado");
  assert.ok(mio);
  const e = await envioDe(codigo);
  assert.deepEqual([e.estado, e.intentos, e.ultimo_error, e.proximo_intento_en], ["Enviado", 2, null, null]);
  assert.match(e.pubsub_message_id, /^fake-msg-\d+$/);
  assert.equal(entorno.pubsub.publicados.length, 1);
});

test("no reintenta antes de tiempo: un envio cuya hora aun no llego no se toca", async () => {
  const codigo = await conEnvioPendiente();
  entorno.pubsub.falla = null;
  await reintentarPendientes();
  assert.equal(entorno.pubsub.publicados.length, 0);
  assert.deepEqual([(await envioDe(codigo)).estado, (await envioDe(codigo)).intentos], ["Pendiente", 1]);
});

test("espera creciente (30 s, 60 s, 120 s, 240 s) y al 5to intento fallido queda en Error", async () => {
  assert.equal(cfg.MAX_INTENTOS, 5);
  const codigo = await conEnvioPendiente(); // intento 1 fallido
  assert.equal(await segundosHastaProximo(codigo), 30);
  const esperas = [60, 120, 240];
  for (let i = 0; i < esperas.length; i++) {
    await vencer(codigo);
    entorno.pubsub.falla = RED();
    await reintentarPendientes();
    const e = await envioDe(codigo);
    assert.deepEqual([e.estado, e.intentos], ["Pendiente", i + 2]);
    assert.equal(await segundosHastaProximo(codigo), esperas[i]);
  }
  await vencer(codigo);
  await reintentarPendientes(); // 5to intento
  const e = await envioDe(codigo);
  assert.deepEqual([e.estado, e.intentos, e.proximo_intento_en], ["Error", 5, null]);
  assert.match(e.ultimo_error, /UNAVAILABLE/);
});

test("un envio en Error ya no se reintenta solo (hay que reenviarlo a mano)", async () => {
  const codigo = await conEnvioPendiente();
  await query(`UPDATE devoluciones.envios_contabilidad_nc SET estado = 'Error', proximo_intento_en = NULL WHERE nota_credito_id = (SELECT n.id FROM devoluciones.notas_credito n JOIN devoluciones.devoluciones d ON d.id = n.devolucion_id WHERE d.codigo = $1)`, [codigo]);
  entorno.pubsub.falla = null;
  await reintentarPendientes();
  assert.equal(entorno.pubsub.publicados.length, 0);
  assert.equal((await envioDe(codigo)).estado, "Error");
});

test("un fallo que no se arregla reintentando (sin permiso) pasa a Error en ese mismo intento", async () => {
  const codigo = await conEnvioPendiente();
  await vencer(codigo);
  entorno.pubsub.falla = Object.assign(new Error("PERMISSION_DENIED"), { code: 7 });
  await reintentarPendientes();
  assert.deepEqual([(await envioDe(codigo)).estado, (await envioDe(codigo)).intentos], ["Error", 2]);
});

test("dos procesos a la vez no toman el mismo envio (SKIP LOCKED y reserva de 2 minutos)", async () => {
  const a = await conEnvioPendiente();
  const b = await conEnvioPendiente();
  await vencer(a);
  await vencer(b);
  const [x, y] = await Promise.all([repo.tomarPendientes(100), repo.tomarPendientes(100)]);
  const idsMios = new Set([(await envioDe(a)).id, (await envioDe(b)).id]);
  const tomados = [...x, ...y].map((e) => e.id).filter((id) => idsMios.has(id));
  assert.equal(tomados.length, 2); // cada uno, una sola vez en total
  assert.equal(new Set(tomados).size, 2);
  // ya reservados: otra toma inmediata no los trae
  assert.equal((await repo.tomarPendientes(100)).filter((e) => idsMios.has(e.id)).length, 0);
});

test("sin topico configurado el proceso no hace nada; con topico arranca y se puede detener", () => {
  const topico = cfg.PUBSUB_TOPIC;
  cfg.PUBSUB_TOPIC = null;
  try {
    assert.equal(typeof iniciar(), "function");
  } finally {
    cfg.PUBSUB_TOPIC = topico;
  }
  const detener = iniciar({ intervaloSeg: 3600 });
  assert.equal(typeof detener, "function");
  detener();
});
