// TDSI-59: POST /api/devoluciones/:codigo/nota-credito/enviar. BD real, Facturacion simulado y un transportador de
// correo FALSO (nunca sale un correo de verdad aunque el .env tenga SMTP). Limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const emailService = require("../services/emailService");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
let enviados; // lo que recibio sendMail
let falla; // si es un Error, sendMail lo lanza
const CAJERO = "cajero.correo@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});
test.beforeEach(() => {
  enviados = [];
  falla = null;
  emailService.usarTransportadorDePrueba({
    sendMail: async (m) => {
      if (falla) throw falla;
      enviados.push(m);
    },
  });
});
test.after(async () => {
  emailService.usarTransportadorDePrueba(undefined);
  await entorno.cerrar();
});

async function procesada() {
  const numero = entorno.agregarFactura(700 + ++contador, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 2 }], motivo_id: motivoId, cajero: CAJERO });
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  const r = await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/reembolsar`, { cajero: CAJERO });
  return { codigo: cuerpo.data.codigo, nota: r.cuerpo.data.nota_credito };
}
const envio = (codigo) => entorno.post(`/api/devoluciones/${codigo}/nota-credito/enviar`, { email: "cliente@correo.com" });
const registrados = async (codigo) =>
  (await query(`SELECT e.email_destino, e.tipo, e.estado, e.enviado_en FROM devoluciones.envios_comprobante e JOIN devoluciones.devoluciones d ON d.id = e.devolucion_id WHERE d.codigo = $1 ORDER BY e.id`, [codigo])).rows;

test("envia el PDF de la nota al correo: adjunto application/pdf, asunto con el numero NC, y deja constancia ENVIADO", async () => {
  const { codigo, nota } = await procesada();
  const r = await envio(codigo);
  assert.equal(r.status, 201);
  assert.deepEqual([r.cuerpo.data.estado, r.cuerpo.data.email, r.cuerpo.data.numero], ["ENVIADO", "cliente@correo.com", nota.numero]);
  assert.equal(enviados.length, 1);
  const m = enviados[0];
  assert.equal(m.to, "cliente@correo.com");
  assert.equal(m.subject, `Nota de crédito ${nota.numero}`);
  assert.match(m.html, new RegExp(nota.numero));
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].contentType, "application/pdf");
  assert.equal(m.attachments[0].filename, `nota-credito-${nota.numero}.pdf`);
  assert.equal(m.attachments[0].content.subarray(0, 5).toString(), "%PDF-");

  const filas = await registrados(codigo);
  assert.deepEqual(filas.map((f) => [f.email_destino, f.tipo, f.estado]), [["cliente@correo.com", "NOTA_CREDITO", "ENVIADO"]]);
  assert.ok(filas[0].enviado_en);
});

test("sin SMTP configurado el envio se SIMULA y queda registrado como SIMULADO (no como enviado)", async () => {
  emailService.usarTransportadorDePrueba(null);
  const { codigo } = await procesada();
  const r = await envio(codigo);
  assert.equal(r.status, 201);
  assert.equal(r.cuerpo.data.estado, "SIMULADO");
  assert.match(r.cuerpo.mensaje, /simulado/i);
  assert.equal(enviados.length, 0);
  assert.deepEqual((await registrados(codigo)).map((f) => f.estado), ["SIMULADO"]);
});

test("si el servidor de correo falla: 502 y el intento queda registrado como ERROR", async () => {
  const { codigo } = await procesada();
  falla = new Error("535 credenciales invalidas");
  const r = await envio(codigo);
  assert.equal(r.status, 502);
  assert.match(r.cuerpo.mensaje, /No se pudo enviar el correo/);
  const filas = await registrados(codigo);
  assert.deepEqual(filas.map((f) => [f.estado, f.enviado_en]), [["ERROR", null]]);
});

test("falta el correo: 400 y no se envia ni se registra nada", async () => {
  const { codigo } = await procesada();
  const r = await entorno.post(`/api/devoluciones/${codigo}/nota-credito/enviar`, {});
  assert.equal(r.status, 400);
  assert.equal(enviados.length, 0);
  assert.equal((await registrados(codigo)).length, 0);
});

test("una devolucion sin nota (no procesada) da 409 y un codigo inexistente 404", async () => {
  const numero = entorno.agregarFactura(790 + ++contador, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1 }], motivo_id: motivoId, cajero: CAJERO });
  assert.equal((await envio(cuerpo.data.codigo)).status, 409);
  assert.equal((await envio("DEV-999999")).status, 404);
  assert.equal(enviados.length, 0);
});

test("se puede reenviar a otro correo: cada envio queda registrado", async () => {
  const { codigo } = await procesada();
  await envio(codigo);
  await entorno.post(`/api/devoluciones/${codigo}/nota-credito/enviar`, { email: "otro@correo.com" });
  assert.deepEqual((await registrados(codigo)).map((f) => f.email_destino), ["cliente@correo.com", "otro@correo.com"]);
});
