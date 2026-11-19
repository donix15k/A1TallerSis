// TDSI-20: GET /api/devoluciones/motivos (base real).
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoInactivoId;

test.before(async () => {
  entorno = await iniciarEntorno();
  const { rows } = await query(
    `INSERT INTO devoluciones.motivos (nombre, activo) VALUES ($1, false) RETURNING id`,
    [`Motivo inactivo de prueba ${entorno.SUFIJO}`]
  );
  motivoInactivoId = rows[0].id;
});

test.after(async () => {
  await query(`DELETE FROM devoluciones.motivos WHERE id = $1`, [motivoInactivoId]);
  await entorno.cerrar();
});

test("lista los 4 motivos activos del catalogo, con id y nombre", async () => {
  const { status, cuerpo } = await entorno.get("/api/devoluciones/motivos");
  assert.equal(status, 200);
  assert.equal(cuerpo.ok, true);
  const nombres = cuerpo.data.map((m) => m.nombre);
  assert.deepEqual(nombres, ["Producto defectuoso", "Producto equivocado", "Cliente se arrepintio", "Otro"]);
  for (const m of cuerpo.data) assert.equal(typeof m.id, "number");
});

test("no muestra los motivos desactivados", async () => {
  const { cuerpo } = await entorno.get("/api/devoluciones/motivos");
  assert.ok(!cuerpo.data.some((m) => /inactivo de prueba/.test(m.nombre)));
});
