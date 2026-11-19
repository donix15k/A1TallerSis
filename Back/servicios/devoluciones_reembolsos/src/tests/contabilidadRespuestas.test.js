// TDSI-94: lectura de la suscripcion donde Contabilidad responde (resultado_documento) para las notas de credito (NC-).
// Pub/Sub FALSO (ni se publica ni se lee de verdad); BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const subscriber = require("../clients/pubsubSubscriber");
const { interpretar } = require("../services/respuestasContabilidadService");
const { procesarRespuestas } = require("../jobs/respuestasContabilidad");
const repo = require("../data/enviosContabilidadRepo");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
let cola; // mensajes que "hay" en la suscripcion
let acks;
let liberados;
let falloLectura;
const CAJERO = "cajero.respuestas@tallersis.test";

const respuesta = (extra) => JSON.stringify({ sistema_origen: "CONTABILIDAD", tipo_mensaje: "resultado_documento", ...extra });
const mensaje = (n, texto) => ({ ackId: `ack-${n}`, message: { messageId: `m-${n}`, data: Buffer.from(texto), attributes: {}, publishTime: { seconds: "1700000000", nanos: 0 } } });

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  subscriber.usarClienteDePrueba({
    pull: async () => {
      if (falloLectura) throw falloLectura;
      return [{ receivedMessages: cola.splice(0) }];
    },
    acknowledge: async ({ ackIds }) => acks.push(...ackIds),
    modifyAckDeadline: async ({ ackIds, ackDeadlineSeconds }) => {
      assert.equal(ackDeadlineSeconds, 0);
      liberados.push(...ackIds);
    },
  });
});
test.beforeEach(() => {
  cola = [];
  acks = [];
  liberados = [];
  falloLectura = null;
});
test.after(async () => {
  subscriber.usarClienteDePrueba(null);
  await entorno.cerrar();
});

async function notaEnviada() {
  const numero = entorno.agregarFactura(60 + ++contador, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: CAJERO });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  const r = await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/reembolsar`, { cajero: CAJERO });
  return { codigo: cuerpo.data.codigo, nota: r.cuerpo.data.nota_credito.numero };
}
const columna = async (codigo) => (await entorno.get(`/api/devoluciones?cajero=${CAJERO}`)).cuerpo.data.find((f) => f.codigo === codigo).contabilidad;

test("interpretar: solo respuestas de Contabilidad (resultado_documento) a una nota NC-NNNNNN", () => {
  assert.deepEqual(interpretar(respuesta({ referencia_externa: "NC-000007", estado: "REGISTRADO", numero_asiento: 4521 })), {
    referencia: "NC-000007", notaNumero: "NC-000007", resultado: "registrado", numeroAsiento: "4521", motivo: null,
  });
  assert.deepEqual(interpretar(respuesta({ referencia_externa: " NC-000008 ", estado: "rechazado", motivo: "Monto no coincide" })), {
    referencia: "NC-000008", notaNumero: "NC-000008", resultado: "rechazado", numeroAsiento: null, motivo: "Monto no coincide",
  });
  for (const texto of [
    "no es json",
    JSON.stringify({ sistema_origen: "COMPRAS", tipo_mensaje: "resultado_documento", referencia_externa: "NC-000001", estado: "registrado" }),
    JSON.stringify({ sistema_origen: "CONTABILIDAD", tipo_mensaje: "otro", referencia_externa: "NC-000001", estado: "registrado" }),
    respuesta({ referencia_externa: "F-000001", estado: "registrado" }), // respuesta a una factura: la lee Facturacion
    respuesta({ referencia_externa: "ANU-F-000001", estado: "registrado" }),
    respuesta({ referencia_externa: "NC-ABC", estado: "registrado" }),
    respuesta({ referencia_externa: "NC-000001" }), // sin estado
    "null",
  ]) {
    assert.equal(interpretar(texto), null, texto);
  }
});

test("la respuesta 'registrado' guarda el N° de asiento en el envio, se confirma (ack) y la columna muestra Registrado", async () => {
  const { codigo, nota } = await notaEnviada();
  assert.equal((await columna(codigo)).estado, "Enviado");
  cola.push(mensaje(1, respuesta({ referencia_externa: nota, estado: "registrado", numero_asiento: "ASI-2026-0042" })));

  const r = await procesarRespuestas();
  assert.equal(r.length, 1);
  assert.deepEqual(acks, ["ack-1"]);
  assert.deepEqual(liberados, []);
  const e = await repo.obtenerPorDevolucionCodigo(codigo);
  assert.deepEqual([e.resultado, e.numero_asiento, e.resultado_motivo], ["registrado", "ASI-2026-0042", null]);
  assert.ok(e.resultado_en);
  assert.deepEqual(await columna(codigo), { estado: "Registrado", numero_asiento: "ASI-2026-0042", motivo: null });
});

test("la respuesta 'rechazado' guarda el motivo y la columna muestra Rechazado con ese motivo", async () => {
  const { codigo, nota } = await notaEnviada();
  cola.push(mensaje(2, respuesta({ referencia_externa: nota, estado: "rechazado", motivo: "La factura original no existe en Contabilidad" })));
  await procesarRespuestas();
  assert.deepEqual(acks, ["ack-2"]);
  assert.deepEqual(await columna(codigo), { estado: "Rechazado", numero_asiento: null, motivo: "La factura original no existe en Contabilidad" });
});

test("los mensajes que no son de nuestras notas se LIBERAN sin confirmar (otros servicios leen la misma suscripcion)", async () => {
  const { codigo, nota } = await notaEnviada();
  cola.push(
    mensaje(3, respuesta({ referencia_externa: "F-000001", estado: "registrado", numero_asiento: "1" })), // factura (de Facturacion)
    mensaje(4, respuesta({ referencia_externa: "NC-999999", estado: "registrado", numero_asiento: "9" })), // nota que no es nuestra
    mensaje(5, "basura"),
    mensaje(6, respuesta({ referencia_externa: nota, estado: "registrado", numero_asiento: "77" }))
  );
  await procesarRespuestas();
  assert.deepEqual(acks, ["ack-6"]);
  assert.deepEqual(liberados.sort(), ["ack-3", "ack-4", "ack-5"]);
  assert.equal((await columna(codigo)).numero_asiento, "77");
});

test("si no se puede leer la suscripcion, el proceso no se cae y lo intenta en la siguiente lectura", async () => {
  falloLectura = new Error("DEADLINE_EXCEEDED");
  assert.deepEqual(await procesarRespuestas(), []);
  falloLectura = null;
  const { codigo, nota } = await notaEnviada();
  cola.push(mensaje(7, respuesta({ referencia_externa: nota, estado: "registrado", numero_asiento: "5" })));
  assert.equal((await procesarRespuestas()).length, 1);
  assert.equal((await columna(codigo)).estado, "Registrado");
});

test("una devolucion sin envio a Contabilidad (aun no procesada) muestra contabilidad = null en la tabla", async () => {
  const numero = entorno.agregarFactura(60 + ++contador, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: CAJERO });
  assert.equal(await columna(cuerpo.data.codigo), null);
});
