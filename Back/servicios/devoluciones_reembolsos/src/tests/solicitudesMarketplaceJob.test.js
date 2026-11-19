// TDSI-113: el job lee de la suscripcion las solicitudes de devolucion del Marketplace. Suscripcion FALSA (nunca se lee de
// verdad), Gestion de Pagos y Facturacion simulados, BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { query } = require("../config/db");
const subscriber = require("../clients/pubsubSubscriber");
const erroresRepo = require("../data/marketplaceErroresRepo");
const { procesarSolicitudes, iniciar, esPasajero } = require("../jobs/solicitudesMarketplace");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let pagos;
let ordenes;
let cola;
let acks;
let liberados;
let falloLectura;
let contador = 0;
const SUF = String(Date.now()).slice(-7);

const contarErrores = async () => (await erroresRepo.listar({ limite: 200 })).filter((e) => String(e.message_id).startsWith(`T113-${SUF}`)).length;
const mensaje = (n, cuerpo) => ({ ackId: `ack-${n}`, message: { messageId: `T113-${SUF}-${n}`, data: Buffer.from(cuerpo), attributes: {}, publishTime: { seconds: "1700000000", nanos: 0 } } });
const solicitud = (orden, extra = {}) => JSON.stringify({ tipo: "SOLICITUD_DEVOLUCION", referencia_externa: `SOL-J-${SUF}-${++contador}`, datos: { orden_id: orden, productos: [{ descripcion: "Producto A", cantidad: 1 }], motivo: "Otro", ...extra } });

test.before(async () => {
  entorno = await iniciarEntorno();
  pagos = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const id = decodeURIComponent(req.url.split("/").pop());
    if (!ordenes.has(id)) { res.statusCode = 404; return res.end(JSON.stringify({ ok: false })); }
    res.end(JSON.stringify({ ok: true, data: ordenes.get(id) }));
  });
  await new Promise((r) => pagos.listen(0, r));
  process.env.GESTION_PAGOS_URL = `http://localhost:${pagos.address().port}`;
  subscriber.usarClienteDePrueba({
    pull: async () => {
      if (falloLectura) throw falloLectura;
      return [{ receivedMessages: cola.splice(0) }];
    },
    acknowledge: async ({ ackIds }) => acks.push(...ackIds),
    modifyAckDeadline: async ({ ackIds }) => liberados.push(...ackIds),
  });
});
test.beforeEach(() => { ordenes = new Map(); cola = []; acks = []; liberados = []; falloLectura = null; });
test.after(async () => {
  subscriber.usarClienteDePrueba(null);
  pagos.closeAllConnections();
  await new Promise((r) => pagos.close(r));
  await query(`DELETE FROM devoluciones.marketplace_solicitudes_error WHERE message_id LIKE $1`, [`T113-${SUF}%`]);
  await entorno.cerrar();
});

function ordenOnline() {
  const id = `ORD-J-${SUF}-${++contador}`;
  const numero = entorno.agregarFactura(300 + contador, { canal: "Online", metodosPago: [{ metodo: "QR", monto: 100 }] });
  ordenes.set(id, { orden_id: id, estado: "Pagado", total: 100, metodo_pago: "QR", numero_factura: numero, factura_emitida: true, items: [{ sku: "SKU-A", descripcion: "Producto A", cantidad: 5, precio_unitario: 10, subtotal: 50 }] });
  return id;
}

test("una solicitud valida de la suscripcion se registra como devolucion MARKETPLACE PENDIENTE y se confirma (ack)", async () => {
  const orden = ordenOnline();
  cola.push(mensaje(1, solicitud(orden)));
  const r = await procesarSolicitudes();
  assert.equal(r.length, 1);
  assert.deepEqual([acks, liberados], [["ack-1"], []]);
  const { rows } = await query(`SELECT origen, estado, orden_id FROM devoluciones.devoluciones WHERE codigo = $1`, [r[0].codigo]);
  assert.deepEqual(rows[0], { origen: "MARKETPLACE", estado: "PENDIENTE", orden_id: orden });
});

test("la bandeja de pendientes ya la muestra con su origen y su orden", async () => {
  const orden = ordenOnline();
  cola.push(mensaje(2, solicitud(orden)));
  const [r] = await procesarSolicitudes();
  const d = (await entorno.get(`/api/devoluciones/${r.codigo}`)).cuerpo.data;
  assert.deepEqual([d.origen, d.orden_id, d.estado], ["MARKETPLACE", orden, "PENDIENTE"]);
});

test("el mismo mensaje repetido NO crea otra devolucion pero igual se confirma (ack)", async () => {
  const orden = ordenOnline();
  const texto = solicitud(orden);
  cola.push(mensaje(3, texto));
  const [a] = await procesarSolicitudes();
  cola.push(mensaje(4, texto));
  const [b] = await procesarSolicitudes();
  assert.deepEqual([b.duplicada, b.codigo], [true, a.codigo]);
  assert.deepEqual(acks, ["ack-3", "ack-4"]);
});

test("una solicitud invalida (orden inexistente, mal formada, no es JSON de nuestro tipo) se guarda con su error y se confirma", async () => {
  cola.push(
    mensaje(5, solicitud("ORD-NO-EXISTE")), // orden inexistente: 404
    mensaje(6, JSON.stringify({ tipo: "SOLICITUD_DEVOLUCION", datos: { productos: [{ descripcion: "X", cantidad: 1 }] } })) // sin orden
  );
  assert.deepEqual(await procesarSolicitudes(), []);
  assert.deepEqual(acks, ["ack-5", "ack-6"]); // todos confirmados: nunca se van a poder procesar
  assert.deepEqual(liberados, []);
  const errores = (await erroresRepo.listar({ limite: 100 })).filter((e) => String(e.message_id).startsWith(`T113-${SUF}`));
  assert.equal(errores.length, 2);
  assert.ok(errores.some((e) => /ORD-NO-EXISTE.*no existe/.test(e.error) && /SOLICITUD_DEVOLUCION/.test(e.payload)));
  assert.ok(errores.some((e) => /no trae el número de orden/.test(e.error)));
});

test("los mensajes que no son solicitudes (otros servicios leen la misma suscripcion) se LIBERAN sin confirmar ni guardar error", async () => {
  cola.push(
    mensaje(7, JSON.stringify({ sistema_origen: "CONTABILIDAD", tipo_mensaje: "resultado_documento", referencia_externa: "NC-000001", estado: "registrado" })),
    mensaje(8, JSON.stringify({ origen: "compras", codigo_devolucion: "DEV-0001", estado: "RECIBIDO" })),
    mensaje(9, "no es json")
  );
  const antes = await contarErrores();
  await procesarSolicitudes();
  assert.deepEqual(acks, []);
  assert.deepEqual(liberados.sort(), ["ack-7", "ack-8", "ack-9"]);
  assert.equal(await contarErrores(), antes);
});

test("un error pasajero (Gestion de Pagos caida) NO descarta la solicitud: se libera para reintentarla", async () => {
  const orden = ordenOnline();
  const url = process.env.GESTION_PAGOS_URL;
  process.env.GESTION_PAGOS_URL = "http://localhost:1";
  cola.push(mensaje(10, solicitud(orden)));
  const antes = await contarErrores();
  try {
    await procesarSolicitudes();
  } finally {
    process.env.GESTION_PAGOS_URL = url;
  }
  assert.deepEqual([acks, liberados], [[], ["ack-10"]]);
  assert.equal(await contarErrores(), antes);
  // al volver Gestion de Pagos, la siguiente lectura la registra
  cola.push(mensaje(11, solicitud(orden)));
  assert.equal((await procesarSolicitudes()).length, 1);
});

test("mezcla en una misma lectura: valida, invalida y ajena; cada una con su destino", async () => {
  const orden = ordenOnline();
  cola.push(mensaje(12, solicitud(orden)), mensaje(13, solicitud("ORD-NO-EXISTE-2")), mensaje(14, JSON.stringify({ tipo: "VENTA" })));
  const r = await procesarSolicitudes();
  assert.equal(r.length, 1);
  assert.deepEqual(acks.sort(), ["ack-12", "ack-13"]);
  assert.deepEqual(liberados, ["ack-14"]);
});

test("si no se puede leer la suscripcion, el job no se cae; esPasajero distingue errores de servicio de solicitudes malas", async () => {
  falloLectura = new Error("DEADLINE_EXCEEDED");
  assert.deepEqual(await procesarSolicitudes(), []);
  assert.equal(esPasajero(new Error("boom")), true);
  assert.equal(esPasajero(Object.assign(new Error("x"), { status: 503 })), true);
  assert.equal(esPasajero(Object.assign(new Error("x"), { status: 422 })), false);
  assert.equal(esPasajero(Object.assign(new Error("x"), { status: 404 })), false);
});

test("el job arranca con la suscripcion configurada y se puede detener", () => {
  const detener = iniciar();
  assert.equal(typeof detener, "function");
  detener();
});
