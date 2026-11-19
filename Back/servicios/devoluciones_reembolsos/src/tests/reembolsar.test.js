// TDSI-49: POST /api/devoluciones/:codigo/reembolsar. Base real; Facturacion, Gestion de Caja y la pasarela son
// servidores HTTP locales (llamadas HTTP de verdad). Limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

const CAJERO = "cajero.reembolsa@tallersis.test";
const CAJA = "CAJA-01";
let entorno;
let motivoId;
let contador = 0;
let caja, pasarela;
let turno; // { id, cajero_id } | null
let esperado;
let movimientos; // referencia -> movimiento
let postsCaja;
let recibidasPasarela;
let estadoPasarela;

function servidor(manejador) {
  const s = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      manejador(req, res, cuerpo ? JSON.parse(cuerpo) : {});
    });
  });
  return new Promise((r) => s.listen(0, () => r(s)));
}

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;

  caja = await servidor((req, res, cuerpo) => {
    if (req.method === "GET" && req.url.startsWith("/api/caja/turnos/actual")) {
      if (!turno) { res.statusCode = 404; return res.end(JSON.stringify({ ok: false, mensaje: "No hay un turno abierto" })); }
      return res.end(JSON.stringify({ ok: true, data: turno }));
    }
    if (req.method === "GET" && /\/efectivo-esperado$/.test(req.url)) return res.end(JSON.stringify({ ok: true, data: { efectivoEsperado: esperado } }));
    if (req.method === "POST" && /\/movimientos$/.test(req.url)) {
      postsCaja.push(cuerpo);
      const previo = movimientos.get(cuerpo.referencia_externa);
      if (previo) { res.statusCode = 409; return res.end(JSON.stringify({ ok: false, mensaje: "ya registrada", detalle: { movimiento: previo } })); }
      const m = { id: String(movimientos.size + 1), ...cuerpo };
      movimientos.set(cuerpo.referencia_externa, m);
      esperado -= cuerpo.monto;
      res.statusCode = 201;
      return res.end(JSON.stringify({ ok: true, data: m }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  process.env.GESTION_CAJA_URL = `http://localhost:${caja.address().port}`;

  pasarela = await servidor((req, res, cuerpo) => {
    recibidasPasarela.push(cuerpo);
    res.statusCode = estadoPasarela;
    res.end("{}");
  });
  process.env.PASARELA_URL = `http://localhost:${pasarela.address().port}`;
});

test.beforeEach(() => {
  turno = { id: 55, cajero_id: CAJERO };
  esperado = 1000;
  movimientos = new Map();
  postsCaja = [];
  recibidasPasarela = [];
  estadoPasarela = 200;
  process.env.PASARELA_MAX_INTENTOS = "3";
  process.env.PASARELA_ESPERA_SEG = "30";
});

test.after(async () => {
  delete process.env.PASARELA_URL;
  for (const s of [caja, pasarela]) { s.closeAllConnections(); await new Promise((r) => s.close(r)); }
  await entorno.cerrar();
});

/** Devolucion de `cantidad` x Producto A (10 Bs c/u) APROBADA, de una factura con esos metodos de pago. */
async function aprobada({ cantidad = 4, metodosPago, canal, aprobar = true } = {}) {
  const numero = entorno.agregarFactura(800 + ++contador, { metodosPago, canal });
  const { cuerpo } = await entorno.post("/api/devoluciones", {
    factura_numero: numero, items: [{ descripcion: "Producto A", cantidad }], motivo_id: motivoId, cajero: CAJERO,
  });
  const codigo = cuerpo.data.codigo;
  if (aprobar) await entorno.post(`/api/devoluciones/${codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  return codigo;
}
const reembolsar = (codigo, cuerpo = { cajero: CAJERO, caja_id: CAJA }) => entorno.post(`/api/devoluciones/${codigo}/reembolsar`, cuerpo);
const estadoDe = async (codigo) => (await entorno.get(`/api/devoluciones/${codigo}`)).cuerpo.data;
const efectivo = [{ metodo: "Efectivo", monto: 100 }];

test("efectivo: entrega, registra la salida en Caja, guarda el reembolso y deja la devolucion PROCESADA con su historial", async () => {
  const codigo = await aprobada({ cantidad: 4, metodosPago: efectivo });
  const r = await reembolsar(codigo);
  assert.equal(r.status, 201);
  assert.equal(r.cuerpo.mensaje, "Entregue Bs 40.00 al cliente");
  assert.equal(r.cuerpo.data.estado, "PROCESADA");
  assert.deepEqual(r.cuerpo.data.reembolsos.map((x) => [x.tipo, x.monto, x.estado, x.envio]), [["EFECTIVO", 40, "PROCESADO", null]]);

  assert.equal(postsCaja.length, 1);
  assert.deepEqual(postsCaja[0], { tipo: "EGRESO", metodo: "Efectivo", monto: 40, origen_microservicio: "DEVOLUCIONES", referencia_externa: codigo, descripcion: `Devolución ${codigo}` });

  const d = await estadoDe(codigo);
  assert.equal(d.estado, "PROCESADA");
  const ultimo = d.historial.at(-1);
  assert.deepEqual([ultimo.estado_anterior, ultimo.estado_nuevo, ultimo.cambiado_por], ["APROBADA", "PROCESADA", CAJERO]);
});

test("una devolucion solo se reembolsa una vez: repetirlo da 409 y NO saca mas efectivo", async () => {
  const codigo = await aprobada({ metodosPago: efectivo });
  assert.equal((await reembolsar(codigo)).status, 201);
  const otra = await reembolsar(codigo);
  assert.equal(otra.status, 409);
  assert.match(otra.cuerpo.mensaje, /ya fue reembolsada/);
  assert.equal(postsCaja.length, 1);
  const { rows } = await query(`SELECT count(*)::int n FROM devoluciones.reembolsos r JOIN devoluciones.devoluciones d ON d.id = r.devolucion_id WHERE d.codigo = $1`, [codigo]);
  assert.equal(rows[0].n, 1);
});

test("dos reembolsos simultaneos de la misma devolucion: uno gana (201), el otro 409, y la salida se registra una sola vez", async () => {
  const codigo = await aprobada({ metodosPago: efectivo });
  const [a, b] = await Promise.all([reembolsar(codigo), reembolsar(codigo)]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(postsCaja.length, 1);
  assert.equal((await estadoDe(codigo)).historial.filter((h) => h.estado_nuevo === "PROCESADA").length, 1);
});

test("tarjeta o QR: no toca la caja; registra la reversion, la envia a la pasarela y responde 'Reversión enviada'", async () => {
  const codigo = await aprobada({ cantidad: 3, metodosPago: [{ metodo: "QR", monto: 100 }] });
  const r = await reembolsar(codigo, { cajero: CAJERO }); // sin caja_id: no hace falta
  assert.equal(r.status, 201);
  assert.match(r.cuerpo.mensaje, /^Reversión enviada: Bs 30\.00 del cobro con QR$/);
  assert.equal(postsCaja.length, 0);
  assert.equal(recibidasPasarela.length, 1);
  assert.equal(recibidasPasarela[0].tipo, "REVERSION_QR");
  assert.equal(recibidasPasarela[0].monto, 30);
  assert.equal(recibidasPasarela[0].referencia, codigo);
  const [x] = r.cuerpo.data.reembolsos;
  assert.deepEqual([x.estado, x.envio.estado, x.envio.intentos], ["PROCESADO", "ENVIADO", 1]);
});

test("si la pasarela falla, el reembolso igual queda hecho: devolucion PROCESADA y la reversion PENDIENTE para reintentar", async () => {
  const codigo = await aprobada({ cantidad: 2, metodosPago: [{ metodo: "Tarjeta", monto: 100 }] });
  estadoPasarela = 500;
  const r = await reembolsar(codigo, { cajero: CAJERO });
  assert.equal(r.status, 201);
  assert.match(r.cuerpo.mensaje, /^Reversión registrada: Bs 20\.00 del cobro con tarjeta se enviará a la pasarela en breve$/);
  const [x] = r.cuerpo.data.reembolsos;
  assert.deepEqual([x.estado, x.envio.estado, x.envio.intentos], ["PENDIENTE", "PENDIENTE", 1]);
  assert.match(x.envio.ultimo_error, /HTTP 500/);
  assert.equal((await estadoDe(codigo)).estado, "PROCESADA");
});

test("pago mixto: la parte en efectivo sale de la caja y la parte QR se revierte", async () => {
  const codigo = await aprobada({ cantidad: 5, metodosPago: [{ metodo: "Efectivo", monto: 20 }, { metodo: "QR", monto: 80 }] });
  const r = await reembolsar(codigo);
  assert.equal(r.status, 201);
  assert.deepEqual(r.cuerpo.data.mensajes, ["Entregue Bs 10.00 al cliente", "Reversión enviada: Bs 40.00 del cobro con QR"]);
  assert.equal(postsCaja[0].monto, 10);
  assert.equal(recibidasPasarela[0].monto, 40);
});

test("efectivo insuficiente (422): no se entrega nada y la devolucion sigue APROBADA", async () => {
  const codigo = await aprobada({ cantidad: 4, metodosPago: efectivo });
  esperado = 39.99;
  const r = await reembolsar(codigo);
  assert.equal(r.status, 422);
  assert.match(r.cuerpo.mensaje, /Efectivo insuficiente en caja/);
  assert.equal(postsCaja.length, 0);
  assert.equal((await estadoDe(codigo)).estado, "APROBADA");
  esperado = 40; // con exactamente lo necesario si alcanza
  assert.equal((await reembolsar(codigo)).status, 201);
});

test("sin turno abierto (422) o turno de otro cajero (403): sigue APROBADA y no sale efectivo", async () => {
  const codigo = await aprobada({ metodosPago: efectivo });
  turno = null;
  const a = await reembolsar(codigo);
  assert.equal(a.status, 422);
  assert.match(a.cuerpo.mensaje, /no tiene un turno abierto/);
  turno = { id: 55, cajero_id: "otro@tallersis.test" };
  assert.equal((await reembolsar(codigo)).status, 403);
  assert.equal(postsCaja.length, 0);
  assert.equal((await estadoDe(codigo)).estado, "APROBADA");
});

test("Caja caida: 503 y la devolucion sigue APROBADA (se puede reintentar)", async () => {
  const codigo = await aprobada({ metodosPago: efectivo });
  const url = process.env.GESTION_CAJA_URL;
  process.env.GESTION_CAJA_URL = "http://localhost:1";
  try {
    assert.equal((await reembolsar(codigo)).status, 503);
  } finally {
    process.env.GESTION_CAJA_URL = url;
  }
  assert.equal((await estadoDe(codigo)).estado, "APROBADA");
  assert.equal((await reembolsar(codigo)).status, 201);
});

test("si la salida ya estaba registrada en Caja (reintento tras una falla), se reutiliza y no se saca dos veces", async () => {
  const codigo = await aprobada({ cantidad: 2, metodosPago: efectivo });
  movimientos.set(codigo, { id: "9", monto: "20.00", referencia_externa: codigo }); // quedo de un intento anterior
  const r = await reembolsar(codigo);
  assert.equal(r.status, 201);
  assert.equal(esperado, 1000); // el stub no descuento otra vez
  assert.equal((await estadoDe(codigo)).estado, "PROCESADA");
});

test("validaciones: falta el cajero (400), efectivo sin caja_id (400), codigo inexistente (404)", async () => {
  const codigo = await aprobada({ metodosPago: efectivo });
  assert.equal((await reembolsar(codigo, { caja_id: CAJA })).status, 400);
  const sinCaja = await reembolsar(codigo, { cajero: CAJERO });
  assert.equal(sinCaja.status, 400);
  assert.match(sinCaja.cuerpo.mensaje, /Falta la caja/);
  assert.equal((await reembolsar("DEV-999999")).status, 404);
  assert.equal((await estadoDe(codigo)).estado, "APROBADA");
});

test("solo se reembolsan las APROBADAS: una PENDIENTE da 409", async () => {
  const codigo = await aprobada({ metodosPago: efectivo, aprobar: false });
  const r = await reembolsar(codigo);
  assert.equal(r.status, 409);
  assert.match(r.cuerpo.mensaje, /está PENDIENTE/);
  assert.equal(postsCaja.length, 0);
});

test("pedido del Marketplace pagado en efectivo: 422, no sale efectivo y sigue APROBADA", async () => {
  const codigo = await aprobada({ metodosPago: efectivo, canal: "Online" });
  const r = await reembolsar(codigo);
  assert.equal(r.status, 422);
  assert.match(r.cuerpo.mensaje, /Marketplace no se reembolsan con efectivo de caja/);
  assert.equal(postsCaja.length, 0);
  assert.equal((await estadoDe(codigo)).estado, "APROBADA");
});

test("GET /:codigo/reembolso de una PROCESADA muestra lo que se hizo", async () => {
  const codigo = await aprobada({ cantidad: 2, metodosPago: [{ metodo: "QR", monto: 100 }] });
  await reembolsar(codigo, { cajero: CAJERO });
  const r = await entorno.get(`/api/devoluciones/${codigo}/reembolso`);
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.data.ya_reembolsada, true);
  assert.deepEqual(r.cuerpo.data.reembolsos.map((x) => [x.tipo, x.monto, x.estado]), [["REVERSION_QR", 20, "PROCESADO"]]);
});
