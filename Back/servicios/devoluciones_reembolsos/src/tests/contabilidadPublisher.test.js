// TDSI-90: cliente Pub/Sub hacia el topico de Contabilidad, con un cliente FALSO (nunca se publica de verdad).
require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const cfg = require("../config/contabilidad");
const publisher = require("../clients/pubsubPublisher");

const topicoFalso = (accion) => ({ publishMessage: accion, iam: { testPermissions: async () => [{ "pubsub.topics.publish": true }] } });
const clienteFalso = (accion, nombres = []) => ({ topic: (nombre) => { nombres.push(nombre); return topicoFalso(accion); } });

test.afterEach(() => publisher.usarClienteDePrueba(null));

test("la configuracion apunta al topico de Contabilidad (ucb-sis323-sub-d), desde el grupo A1, con 5 intentos y worker de 60 s", () => {
  assert.match(cfg.PUBSUB_TOPIC, /\/topics\/ucb-sis323-sub-d$/);
  assert.equal(cfg.GRUPO_ORIGEN, "A1");
  assert.equal(cfg.MAX_INTENTOS, 5);
  assert.equal(cfg.INTERVALO_WORKER_SEG, 60);
  assert.ok(cfg.GOOGLE_CREDENTIALS.client_email && cfg.GOOGLE_CREDENTIALS.private_key); // la credencial sale del .env
});

test("publicar manda el JSON y los atributos (como texto) al topico configurado y devuelve el messageId", async () => {
  const recibido = [];
  const nombres = [];
  publisher.usarClienteDePrueba(clienteFalso(async (m) => { recibido.push(m); return "msg-123"; }, nombres));
  const r = await publisher.publicar({ referencia_externa: "NC-000001" }, { grupo: "A1", n: 5, vacio: null, indefinido: undefined });
  assert.deepEqual(r, { ok: true, messageId: "msg-123" });
  assert.equal(nombres[0], cfg.PUBSUB_TOPIC);
  assert.deepEqual(recibido[0], { json: { referencia_externa: "NC-000001" }, attributes: { grupo: "A1", n: "5" } });
});

test("un error de red es reintentable; un error de permisos o topico inexistente no", async () => {
  for (const [code, reintentable] of [[14, true], [4, true], [undefined, true], [3, false], [5, false], [7, false], [16, false]]) {
    publisher.usarClienteDePrueba(clienteFalso(async () => { throw Object.assign(new Error("fallo"), { code }); }));
    const r = await publisher.publicar({ a: 1 });
    assert.deepEqual([r.ok, r.reintentable], [false, reintentable], String(code));
    assert.match(r.error, /^Pub\/Sub: fallo/);
  }
});

test("si Pub/Sub no responde a tiempo: fallo reintentable por tiempo agotado", async () => {
  const guardado = process.env.PUBSUB_TIMEOUT_MS;
  // el limite sale de la configuracion (minimo 1000 ms): se simula con un cliente que nunca responde y un error de tiempo
  publisher.usarClienteDePrueba(clienteFalso(() => Promise.reject(Object.assign(new Error("Pub/Sub no respondio en 1 ms"), { tiempoAgotado: true }))));
  const r = await publisher.publicar({ a: 1 });
  assert.deepEqual([r.ok, r.reintentable], [false, true]);
  process.env.PUBSUB_TIMEOUT_MS = guardado;
});

test("verificarPermiso comprueba el permiso de publicar sin publicar nada", async () => {
  let publicados = 0;
  publisher.usarClienteDePrueba(clienteFalso(async () => { publicados++; return "x"; }));
  assert.deepEqual(await publisher.verificarPermiso(), { ok: true });
  assert.equal(publicados, 0);
  publisher.usarClienteDePrueba({ topic: () => ({ iam: { testPermissions: async () => [{ "pubsub.topics.publish": false }] } }) });
  assert.equal((await publisher.verificarPermiso()).ok, false);
});
