// TDSI-105: lectura del acuse de Compras (RECIBIDO o RECLAMO_REGISTRADO con N° de reclamo) en la suscripcion compartida.
// Pub/Sub FALSO (ni se publica ni se lee de verdad); BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const subscriber = require("../clients/pubsubSubscriber");
const cfg = require("../config/compras");
const { interpretar } = require("../services/acusesComprasService");
const { procesarRespuestas } = require("../jobs/respuestasContabilidad");
const repo = require("../data/enviosComprasRepo");
const { iniciarEntorno } = require("./helpers/entorno");

const TOPICO = "projects/project-test-12345/topics/ucb-sis323-sub-c";
let entorno;
let motivoId;
let contador = 0;
let topicoOriginal;
let cola;
let acks;
let liberados;
const CAJERO = "cajero.acuses@tallersis.test";

const acuse = (extra) => JSON.stringify({ origen: "compras", ...extra });
const mensaje = (n, cuerpo) => ({ ackId: `ack-${n}`, message: { messageId: `m-${n}`, data: Buffer.from(cuerpo), attributes: {}, publishTime: { seconds: "1700000000", nanos: 0 } } });

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  topicoOriginal = cfg.PUBSUB_TOPIC;
  cfg.PUBSUB_TOPIC = TOPICO;
  subscriber.usarClienteDePrueba({
    pull: async () => [{ receivedMessages: cola.splice(0) }],
    acknowledge: async ({ ackIds }) => acks.push(...ackIds),
    modifyAckDeadline: async ({ ackIds }) => liberados.push(...ackIds),
  });
});
test.beforeEach(() => {
  cola = [];
  acks = [];
  liberados = [];
  entorno.pubsub.publicados.length = 0;
  entorno.pubsub.falla = null;
});
test.after(async () => {
  cfg.PUBSUB_TOPIC = topicoOriginal;
  subscriber.usarClienteDePrueba(null);
  await entorno.cerrar();
});

async function avisada() {
  const numero = entorno.agregarFactura(10 + ++contador, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", {
    factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1, estado_producto: "DEFECTUOSO" }], motivo_id: motivoId, cajero: CAJERO,
  });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/reembolsar`, { cajero: CAJERO });
  return cuerpo.data.codigo;
}

test("interpretar: solo acuses de Compras a una devolucion DEV-NNNN con estado RECIBIDO o RECLAMO_REGISTRADO", () => {
  assert.deepEqual(interpretar(acuse({ codigo_devolucion: "DEV-0042", estado: "RECIBIDO" })), { referencia: "DEV-0042", codigo: "DEV-0042", acuse: "RECIBIDO", numeroReclamo: null });
  assert.deepEqual(interpretar(acuse({ referencia_externa: "dev-0043", estado: "reclamo registrado", numero_reclamo: 981 })), { referencia: "DEV-0043", codigo: "DEV-0043", acuse: "RECLAMO_REGISTRADO", numeroReclamo: "981" });
  assert.equal(interpretar(JSON.stringify({ sistema_origen: "GESTION_DE_COMPRAS_Y_PROVEEDORES", reporte_id: "DEV-0044", estado: "RECIBIDO" })).codigo, "DEV-0044");
  for (const t of [
    "no es json",
    "null",
    JSON.stringify({ origen: "contabilidad", codigo_devolucion: "DEV-0042", estado: "RECIBIDO" }),
    acuse({ reporte_id: "PV-2026-03-10" }), // acuse de un reporte de ventas: lo lee Gestion de Pagos
    acuse({ codigo_devolucion: "DEV-0042" }), // sin estado
    acuse({ codigo_devolucion: "DEV-0042", estado: "OTRA_COSA" }),
    acuse({ codigo_devolucion: "ABC", estado: "RECIBIDO" }),
  ]) {
    assert.equal(interpretar(t), null, t);
  }
});

test("el acuse RECIBIDO deja el aviso en Recibido, se confirma (ack) y no inventa un reclamo", async () => {
  const codigo = await avisada();
  assert.equal((await repo.obtenerPorCodigo(codigo)).estado, "Enviado");
  cola.push(mensaje(1, acuse({ codigo_devolucion: codigo, estado: "RECIBIDO" })));
  const r = await procesarRespuestas();
  assert.equal(r.length, 1);
  assert.deepEqual([acks, liberados], [["ack-1"], []]);
  const e = await repo.obtenerPorCodigo(codigo);
  assert.deepEqual([e.estado, e.acuse, e.numero_reclamo], ["Recibido", "RECIBIDO", null]);
  assert.ok(e.acuse_en);
});

test("RECLAMO_REGISTRADO guarda el N° de reclamo y se ve como 'Reclamo registrado'", async () => {
  const codigo = await avisada();
  cola.push(mensaje(2, acuse({ codigo_devolucion: codigo, estado: "RECLAMO_REGISTRADO", numero_reclamo: "REC-0007" })));
  await procesarRespuestas();
  assert.deepEqual(acks, ["ack-2"]);
  const e = await repo.obtenerPorCodigo(codigo);
  assert.deepEqual([e.estado, e.acuse, e.numero_reclamo], ["Recibido", "RECLAMO_REGISTRADO", "REC-0007"]);
  assert.deepEqual(repo.estadoVisible(e), { estado: "Reclamo registrado", numero_reclamo: "REC-0007" });
});

test("un acuse repetido no duplica ni pisa nada, y el reclamo que llega despues del RECIBIDO se agrega", async () => {
  const codigo = await avisada();
  cola.push(mensaje(3, acuse({ codigo_devolucion: codigo, estado: "RECIBIDO" })));
  await procesarRespuestas();
  const primero = await repo.obtenerPorCodigo(codigo);
  cola.push(mensaje(4, acuse({ codigo_devolucion: codigo, estado: "RECIBIDO" })));
  await procesarRespuestas();
  const repetido = await repo.obtenerPorCodigo(codigo);
  assert.equal(new Date(repetido.acuse_en).getTime(), new Date(primero.acuse_en).getTime());
  assert.deepEqual(acks, ["ack-3", "ack-4"]);

  cola.push(mensaje(5, acuse({ codigo_devolucion: codigo, estado: "RECLAMO_REGISTRADO", numero_reclamo: "REC-9" })));
  await procesarRespuestas();
  const final = await repo.obtenerPorCodigo(codigo);
  assert.deepEqual([final.acuse, final.numero_reclamo], ["RECLAMO_REGISTRADO", "REC-9"]);
  cola.push(mensaje(6, acuse({ codigo_devolucion: codigo, estado: "RECIBIDO" }))); // ya no baja de RECLAMO a RECIBIDO
  await procesarRespuestas();
  assert.equal((await repo.obtenerPorCodigo(codigo)).acuse, "RECLAMO_REGISTRADO");
});

test("los mensajes que no son de nuestras devoluciones se LIBERAN sin confirmar (la suscripcion es compartida)", async () => {
  const codigo = await avisada();
  cola.push(
    mensaje(7, acuse({ reporte_id: "PV-2026-03-10", estado: "RECIBIDO" })), // acuse de ventas del dia (Gestion de Pagos)
    mensaje(8, acuse({ codigo_devolucion: "DEV-999999", estado: "RECIBIDO" })), // devolucion que no es nuestra
    mensaje(9, JSON.stringify({ sistema_origen: "CONTABILIDAD", tipo_mensaje: "resultado_documento", referencia_externa: "F-000001", estado: "registrado" })),
    mensaje(10, acuse({ codigo_devolucion: codigo, estado: "RECIBIDO" }))
  );
  await procesarRespuestas();
  assert.deepEqual(acks, ["ack-10"]);
  assert.deepEqual(liberados.sort(), ["ack-7", "ack-8", "ack-9"]);
});

test("la respuesta de Contabilidad a una nota y el acuse de Compras conviven en la misma lectura", async () => {
  const codigo = await avisada();
  const nota = (await entorno.get(`/api/devoluciones/${codigo}/nota-credito`)).cuerpo.data.numero;
  cola.push(
    mensaje(11, JSON.stringify({ sistema_origen: "CONTABILIDAD", tipo_mensaje: "resultado_documento", referencia_externa: nota, estado: "registrado", numero_asiento: "A-1" })),
    mensaje(12, acuse({ codigo_devolucion: codigo, estado: "RECIBIDO" }))
  );
  const r = await procesarRespuestas();
  assert.equal(r.length, 2);
  assert.deepEqual(acks.sort(), ["ack-11", "ack-12"]);
});
