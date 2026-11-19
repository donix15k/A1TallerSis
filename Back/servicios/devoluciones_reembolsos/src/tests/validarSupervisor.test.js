// TDSI-34: FacturacionProxy.validarSupervisor contra un servidor HTTP local que imita a Facturacion
// (llamadas HTTP de verdad, sin mockear fetch). La prueba contra el Facturacion real, con un supervisor de
// prueba, se hace aparte con el servicio levantado.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { validarSupervisor } = require("../services/facturacionProxy");

let servidor;
let recibidas;
let respuesta; // { status, cuerpo } | "colgado"

test.before(async () => {
  servidor = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      recibidas.push({ metodo: req.method, url: req.url, cuerpo: JSON.parse(cuerpo || "{}"), tipo: req.headers["content-type"] });
      if (respuesta === "colgado") return;
      res.statusCode = respuesta.status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(respuesta.cuerpo));
    });
  });
  await new Promise((r) => servidor.listen(0, r));
  process.env.FACTURACION_URL = `http://localhost:${servidor.address().port}`;
});

test.beforeEach(() => {
  recibidas = [];
  respuesta = { status: 200, cuerpo: { ok: true, data: { supervisor_id: "SUP-1", nombre: "Ana Supervisora" } } };
  process.env.FACTURACION_TIMEOUT_MS = "5000";
});

test.after(() => {
  servidor.closeAllConnections();
  return new Promise((r) => servidor.close(r));
});

test("PIN correcto: devuelve el supervisor y llama a POST /api/supervisores/validar con usuario y PIN", async () => {
  const s = await validarSupervisor("  SUP-1 ", "1234");
  assert.deepEqual(s, { supervisor_id: "SUP-1", nombre: "Ana Supervisora" });
  assert.equal(recibidas.length, 1);
  assert.equal(recibidas[0].metodo, "POST");
  assert.equal(recibidas[0].url, "/api/supervisores/validar");
  assert.equal(recibidas[0].tipo, "application/json");
  assert.deepEqual(recibidas[0].cuerpo, { supervisor_id: "SUP-1", pin: "1234" }); // el usuario se limpia, el PIN va tal cual
});

test("usuario o PIN incorrecto (401): 'Usuario o PIN incorrecto' con los intentos que quedan", async () => {
  respuesta = { status: 401, cuerpo: { ok: false, mensaje: "Supervisor o PIN incorrecto", detalle: { intentos_restantes: 2 } } };
  await assert.rejects(validarSupervisor("SUP-1", "0000"), (e) => {
    assert.equal(e.status, 401);
    assert.equal(e.message, "Usuario o PIN incorrecto");
    assert.deepEqual(e.detalle, { intentos_restantes: 2 });
    return true;
  });
});

test("supervisor bloqueado (423): respeta el bloqueo, conserva el mensaje y la hora, y no reintenta", async () => {
  respuesta = { status: 423, cuerpo: { ok: false, mensaje: "Supervisor bloqueado por intentos fallidos. Intente en 14 minuto(s)", detalle: { bloqueado_hasta: "2026-11-19T05:00:00.000Z" } } };
  await assert.rejects(validarSupervisor("SUP-1", "1234"), (e) => {
    assert.equal(e.status, 423);
    assert.match(e.message, /bloqueado por intentos fallidos.*14 minuto/);
    assert.equal(e.detalle.bloqueado_hasta, "2026-11-19T05:00:00.000Z");
    return true;
  });
  assert.equal(recibidas.length, 1, "no debe reintentar: cada intento contaria para el bloqueo");
});

test("bloqueo tras el 3er fallo (423 al fallar): tambien se respeta", async () => {
  respuesta = { status: 423, cuerpo: { ok: false, mensaje: "PIN incorrecto. Supervisor bloqueado por 15 minutos", detalle: { bloqueado_hasta: "2026-11-19T05:15:00.000Z" } } };
  await assert.rejects(validarSupervisor("SUP-1", "9999"), (e) => e.status === 423 && /bloqueado por 15 minutos/.test(e.message));
});

test("PIN con formato invalido (400 de Facturacion): se propaga el 400", async () => {
  respuesta = { status: 400, cuerpo: { ok: false, mensaje: "El PIN debe tener entre 4 y 6 dígitos" } };
  await assert.rejects(validarSupervisor("SUP-1", "12"), (e) => e.status === 400 && /4 y 6 dígitos/.test(e.message));
});

test("usuario o PIN vacios, o PIN que no es texto: 400 sin llamar a Facturacion", async () => {
  for (const [usuario, pin] of [["", "1234"], ["   ", "1234"], [undefined, "1234"], ["SUP-1", ""], ["SUP-1", undefined], ["SUP-1", 1234]]) {
    await assert.rejects(validarSupervisor(usuario, pin), (e) => e.status === 400, `deberia rechazar ${JSON.stringify([usuario, pin])}`);
  }
  assert.equal(recibidas.length, 0);
});

test("Facturacion caida o sin responder: 503, y el PIN no aparece en el error", async () => {
  const urlAnterior = process.env.FACTURACION_URL;
  process.env.FACTURACION_URL = "http://localhost:1";
  try {
    await assert.rejects(validarSupervisor("SUP-1", "7777"), (e) => {
      assert.equal(e.status, 503);
      assert.ok(!JSON.stringify([e.message, e.detalle]).includes("7777"), "el PIN no debe filtrarse al error");
      return true;
    });
  } finally {
    process.env.FACTURACION_URL = urlAnterior;
  }

  respuesta = "colgado";
  process.env.FACTURACION_TIMEOUT_MS = "200";
  await assert.rejects(validarSupervisor("SUP-1", "7777"), (e) => e.status === 503 && /no respondió a tiempo/.test(e.message));
});

test("respuesta inesperada de Facturacion: 502", async () => {
  respuesta = { status: 500, cuerpo: { ok: false, mensaje: "Error interno del servidor" } };
  await assert.rejects(validarSupervisor("SUP-1", "1234"), (e) => e.status === 502);
});
