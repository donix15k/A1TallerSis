// TDSI-46: CajaProxy.registrarSalidaEfectivo contra un servidor HTTP local que imita a Gestion de Caja (llamadas
// HTTP de verdad, sin mockear fetch). La prueba contra la Gestion de Caja real se hace aparte con el servicio levantado.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { registrarSalidaEfectivo } = require("../services/cajaProxy");

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
  process.env.GESTION_CAJA_URL = `http://localhost:${servidor.address().port}`;
});

test.beforeEach(() => {
  recibidas = [];
  respuesta = { status: 201, cuerpo: { ok: true, data: { id: "77", tipo: "EGRESO", metodo: "Efectivo", monto: "40.00", referencia_externa: "DEV-0001" } } };
  process.env.CAJA_TIMEOUT_MS = "5000";
});

test.after(() => {
  servidor.closeAllConnections();
  return new Promise((r) => servidor.close(r));
});

test("registra la salida: POST al turno, EGRESO en efectivo, origen DEVOLUCIONES y concepto 'Devolución DEV-0001'", async () => {
  const r = await registrarSalidaEfectivo({ turnoId: 12, monto: 40, codigo: "DEV-0001" });
  assert.equal(r.duplicado, false);
  assert.equal(r.movimiento.id, "77");
  assert.equal(recibidas.length, 1);
  assert.equal(recibidas[0].metodo, "POST");
  assert.equal(recibidas[0].url, "/api/caja/turnos/12/movimientos");
  assert.equal(recibidas[0].tipo, "application/json");
  assert.deepEqual(recibidas[0].cuerpo, {
    tipo: "EGRESO",
    metodo: "Efectivo",
    monto: 40,
    origen_microservicio: "DEVOLUCIONES",
    referencia_externa: "DEV-0001",
    descripcion: "Devolución DEV-0001",
  });
});

test("si Caja ya tenia registrada esa salida (409), no es un error: devuelve el movimiento existente como duplicado", async () => {
  respuesta = { status: 409, cuerpo: { ok: false, mensaje: "La devolucion DEV-0001 ya tiene registrada su salida de efectivo", detalle: { movimiento: { id: "55", monto: "40.00" } } } };
  const r = await registrarSalidaEfectivo({ turnoId: 12, monto: 40, codigo: "DEV-0001" });
  assert.equal(r.duplicado, true);
  assert.equal(r.movimiento.id, "55");
});

test("turno inexistente (404), turno cerrado (423) y datos invalidos (400): se propaga el error con su estado y mensaje", async () => {
  for (const [status, mensaje] of [[404, "Turno no encontrado"], [423, "El turno esta cerrado: no se pueden registrar nuevas ventas en esta caja"], [400, "El monto debe ser un numero mayor a 0"]]) {
    respuesta = { status, cuerpo: { ok: false, mensaje, detalle: { turnoId: 12 } } };
    await assert.rejects(registrarSalidaEfectivo({ turnoId: 12, monto: 40, codigo: "DEV-0001" }), (e) => e.status === status && e.message === mensaje, String(status));
  }
});

test("Caja caida o sin responder a tiempo: 503", async () => {
  const urlAnterior = process.env.GESTION_CAJA_URL;
  process.env.GESTION_CAJA_URL = "http://localhost:1";
  try {
    await assert.rejects(registrarSalidaEfectivo({ turnoId: 12, monto: 40, codigo: "DEV-0001" }), (e) => e.status === 503 && /No se pudo conectar/.test(e.message));
  } finally {
    process.env.GESTION_CAJA_URL = urlAnterior;
  }
  respuesta = "colgado";
  process.env.CAJA_TIMEOUT_MS = "200";
  await assert.rejects(registrarSalidaEfectivo({ turnoId: 12, monto: 40, codigo: "DEV-0001" }), (e) => e.status === 503 && /no respondió a tiempo/.test(e.message));
});

test("respuesta inesperada de Caja (por ejemplo 500): 502", async () => {
  respuesta = { status: 500, cuerpo: { ok: false, mensaje: "Error interno del servidor" } };
  await assert.rejects(registrarSalidaEfectivo({ turnoId: 12, monto: 40, codigo: "DEV-0001" }), (e) => e.status === 502);
});

// ---------- TDSI-47: validarEfectivoDisponible ----------
const { validarEfectivoDisponible } = require("../services/cajaProxy");

test("TDSI-47: turno abierto del cajero con efectivo suficiente -> devuelve el turno y el esperado", async () => {
  const servidor2 = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/api/caja/turnos/actual")) return res.end(JSON.stringify({ ok: true, data: { id: 9, cajero_id: "Cajero@x.test" } }));
    res.end(JSON.stringify({ ok: true, data: { efectivoEsperado: 120.5 } }));
  });
  await new Promise((r) => servidor2.listen(0, r));
  const anterior = process.env.GESTION_CAJA_URL;
  process.env.GESTION_CAJA_URL = `http://localhost:${servidor2.address().port}`;
  try {
    assert.deepEqual(await validarEfectivoDisponible({ cajaId: "CAJA-01", cajero: "cajero@x.test", monto: 120.5 }), { turnoId: 9, efectivoEsperado: 120.5 });
    await assert.rejects(validarEfectivoDisponible({ cajaId: "CAJA-01", cajero: "cajero@x.test", monto: 120.51 }), (e) => e.status === 422 && /Efectivo insuficiente en caja: hay Bs 120\.50 y el reembolso es de Bs 120\.51/.test(e.message));
    await assert.rejects(validarEfectivoDisponible({ cajaId: "CAJA-01", cajero: "otro@x.test", monto: 10 }), (e) => e.status === 403 && /otro cajero/.test(e.message));
  } finally {
    process.env.GESTION_CAJA_URL = anterior;
    servidor2.closeAllConnections();
    await new Promise((r) => servidor2.close(r));
  }
});

test("TDSI-47: caja sin turno abierto -> 422; Caja caida -> 503", async () => {
  respuesta = { status: 404, cuerpo: { ok: false, mensaje: "No hay un turno abierto para la caja" } };
  await assert.rejects(validarEfectivoDisponible({ cajaId: "CAJA-01", cajero: "c@x.test", monto: 10 }), (e) => e.status === 422 && /no tiene un turno abierto/.test(e.message));
  const anterior = process.env.GESTION_CAJA_URL;
  process.env.GESTION_CAJA_URL = "http://localhost:1";
  try {
    await assert.rejects(validarEfectivoDisponible({ cajaId: "CAJA-01", cajero: "c@x.test", monto: 10 }), (e) => e.status === 503);
  } finally {
    process.env.GESTION_CAJA_URL = anterior;
  }
});
