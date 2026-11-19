// TDSI-115: las solicitudes invalidas del Marketplace se guardan con su error para revisarlas. BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query, pool } = require("../config/db");
const repo = require("../data/marketplaceErroresRepo");

const SUF = `T115-${Date.now()}`;

test.after(async () => {
  await query(`DELETE FROM devoluciones.marketplace_solicitudes_error WHERE message_id LIKE $1`, [`${SUF}%`]);
  await pool.end();
});

test("registrar guarda el id del mensaje, el error y el contenido tal cual llego", async () => {
  const r = await repo.registrar({ messageId: `${SUF}-1`, error: "La orden ORD-9 no existe en las ventas online.", payload: '{"tipo":"SOLICITUD_DEVOLUCION"}' });
  assert.ok(r.id > 0);
  assert.deepEqual([r.message_id, r.error, r.payload], [`${SUF}-1`, "La orden ORD-9 no existe en las ventas online.", '{"tipo":"SOLICITUD_DEVOLUCION"}']);
  assert.ok(r.recibido_en);
});

test("guarda tambien lo que no es JSON y los errores/payload muy largos se recortan sin romper", async () => {
  const a = await repo.registrar({ messageId: `${SUF}-2`, error: "no es json", payload: "esto no es json {{" });
  assert.equal(a.payload, "esto no es json {{");
  const b = await repo.registrar({ messageId: `${SUF}-3`, error: "x".repeat(900), payload: null });
  assert.equal(b.error.length, 500);
  assert.equal(b.payload, null);
  const c = await repo.registrar({ messageId: "z".repeat(150), error: "id largo" });
  assert.equal(c.message_id.length, 100);
  await query(`DELETE FROM devoluciones.marketplace_solicitudes_error WHERE id = $1`, [c.id]);
});

test("listar trae lo mas reciente primero", async () => {
  const lista = await repo.listar({ limite: 200 });
  const mios = lista.filter((x) => String(x.message_id).startsWith(SUF)).map((x) => x.message_id);
  assert.deepEqual(mios, [`${SUF}-3`, `${SUF}-2`, `${SUF}-1`]);
  assert.equal((await repo.listar({ limite: 1 })).length, 1);
});
