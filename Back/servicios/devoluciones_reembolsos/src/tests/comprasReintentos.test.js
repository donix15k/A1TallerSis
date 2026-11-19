// TDSI-106: los avisos a Compras que fallan se reintentan solos, junto con los de Contabilidad. Pub/Sub FALSO; BD real.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const cfg = require("../config/compras");
const repo = require("../data/enviosComprasRepo");
const { reintentarPendientes, iniciar } = require("../jobs/reintentoEnviosContabilidad");
const { iniciarEntorno } = require("./helpers/entorno");

const TOPICO = "projects/project-test-12345/topics/ucb-sis323-sub-c";
let entorno;
let motivoId;
let contador = 0;
let topicoOriginal;
const CAJERO = "cajero.reintcompras@tallersis.test";
const RED = () => Object.assign(new Error("UNAVAILABLE"), { code: 14 });

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  topicoOriginal = cfg.PUBSUB_TOPIC;
  cfg.PUBSUB_TOPIC = TOPICO;
});
test.beforeEach(() => {
  entorno.pubsub.publicados.length = 0;
  entorno.pubsub.falla = null;
});
test.after(async () => {
  cfg.PUBSUB_TOPIC = topicoOriginal;
  await entorno.cerrar();
});

/** Procesa una devolucion con Pub/Sub caido: sus avisos (Contabilidad y Compras) quedan Pendientes. */
async function conAvisoPendiente() {
  const numero = entorno.agregarFactura(5 + ++contador, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1, estado_producto: "DEFECTUOSO" }], motivo_id: motivoId, cajero: CAJERO });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  entorno.pubsub.falla = RED();
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/reembolsar`, { cajero: CAJERO });
  entorno.pubsub.falla = null;
  return cuerpo.data.codigo;
}
const vencer = (codigo) => query(
  `UPDATE devoluciones.envios_compras_dev SET proximo_intento_en = now() - interval '1 second' WHERE devolucion_id = (SELECT id FROM devoluciones.devoluciones WHERE codigo = $1) AND estado = 'Pendiente'`,
  [codigo]
);
const vencerContabilidad = (codigo) => query(
  `UPDATE devoluciones.envios_contabilidad_nc SET proximo_intento_en = now() - interval '1 second' WHERE nota_credito_id = (SELECT n.id FROM devoluciones.notas_credito n JOIN devoluciones.devoluciones d ON d.id = n.devolucion_id WHERE d.codigo = $1) AND estado = 'Pendiente'`,
  [codigo]
);
const aCompras = () => entorno.pubsub.publicados.filter((p) => p.topico === TOPICO);

test("el aviso a Compras que fallo se vuelve a publicar solo cuando le toca: queda Enviado con su messageId", async () => {
  const codigo = await conAvisoPendiente();
  assert.equal((await repo.obtenerPorCodigo(codigo)).estado, "Pendiente");
  await vencer(codigo);
  const r = await reintentarPendientes();
  assert.ok(r.some((x) => x.destino === "compras" && x.estado === "Enviado"));
  const e = await repo.obtenerPorCodigo(codigo);
  assert.deepEqual([e.estado, e.intentos, e.ultimo_error, e.proximo_intento_en], ["Enviado", 2, null, null]);
  assert.match(e.pubsub_message_id, /^fake-msg-\d+$/);
  assert.equal(aCompras().length, 1);
  assert.equal(aCompras()[0].attributes.idempotency_key, codigo); // sigue siendo UN solo aviso por devolucion
});

test("antes de la hora del reintento no se toca; espera creciente y al 5to intento fallido queda en Error", async () => {
  const codigo = await conAvisoPendiente();
  await reintentarPendientes();
  assert.equal(aCompras().length, 0);
  assert.deepEqual([(await repo.obtenerPorCodigo(codigo)).estado, (await repo.obtenerPorCodigo(codigo)).intentos], ["Pendiente", 1]);

  const esperas = [];
  for (let i = 0; i < 3; i++) {
    await vencer(codigo);
    entorno.pubsub.falla = RED();
    await reintentarPendientes();
    const { rows } = await query(`SELECT extract(epoch FROM (e.proximo_intento_en - e.ultimo_intento_en)) AS s FROM devoluciones.envios_compras_dev e JOIN devoluciones.devoluciones d ON d.id = e.devolucion_id WHERE d.codigo = $1`, [codigo]);
    esperas.push(Math.round(Number(rows[0].s)));
  }
  assert.deepEqual(esperas, [60, 120, 240]);
  await vencer(codigo);
  await reintentarPendientes(); // 5to intento
  const e = await repo.obtenerPorCodigo(codigo);
  assert.deepEqual([e.estado, e.intentos, e.proximo_intento_en], ["Error", 5, null]);
  entorno.pubsub.falla = null;
  await reintentarPendientes(); // en Error ya no se reintenta solo
  assert.equal(aCompras().length, 0);
});

test("el mismo proceso reintenta a Contabilidad y a Compras en una sola pasada", async () => {
  const codigo = await conAvisoPendiente();
  await vencer(codigo);
  await vencerContabilidad(codigo);
  const r = await reintentarPendientes();
  const mios = r.filter((x) => x.estado === "Enviado");
  assert.ok(mios.some((x) => x.destino === "compras"));
  assert.ok(mios.some((x) => x.destino === "contabilidad"));
  assert.equal(entorno.pubsub.publicados.filter((p) => p.attributes.referencia_externa === codigo).length, 1); // el de Compras
});

test("con la integracion de Compras apagada (sin topico) solo se reintenta a Contabilidad", async () => {
  const codigo = await conAvisoPendiente();
  await vencer(codigo);
  cfg.PUBSUB_TOPIC = null;
  try {
    const r = await reintentarPendientes();
    assert.ok(!r.some((x) => x.destino === "compras"));
    assert.equal((await repo.obtenerPorCodigo(codigo)).estado, "Pendiente"); // se retomara cuando se prenda
  } finally {
    cfg.PUBSUB_TOPIC = TOPICO;
  }
});

test("el proceso arranca si hay al menos un destino con topico y se puede detener", () => {
  const detener = iniciar({ intervaloSeg: 3600 });
  assert.equal(typeof detener, "function");
  detener();
});
