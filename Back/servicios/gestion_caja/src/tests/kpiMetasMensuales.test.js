// TDSI-200/202: GET y PUT /api/kpis/metas-mensuales (la meta mensual de cada caja, filas "Meta Caja N" de "Configurar objetivos"). BD real:
// cajas y metas de prueba que se borran al terminar. La validacion de administrador real solo se prueba sin token (401).
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const { requireAdministrador } = require("../middlewares/requireAdministrador");
const rutas = require("../routes/kpiRoutes");
const { errorDeMonto, MONTO_MAXIMO } = require("../services/kpiMetasMensualesService");

const A = "CAJA-T200A";
const B = "CAJA-T200B";
const X = "CAJA-T200X"; // inactiva
let servidor, base, protegido, baseProtegida;

const limpiar = async () => {
  await query(`DELETE FROM caja.metas_mensuales WHERE caja_id = ANY($1)`, [[A, B, X]]);
  await query(`DELETE FROM caja.metas_venta WHERE caja_id = ANY($1)`, [[A, B, X]]);
  await query(`DELETE FROM caja.cajas WHERE codigo = ANY($1)`, [[A, B, X]]);
};

test.before(async () => {
  await limpiar();
  await query(`INSERT INTO caja.cajas (codigo, nombre, estado) VALUES ($1, 'T200 A', 'ACTIVA'), ($2, 'T200 B', 'ACTIVA'), ($3, 'T200 X', 'INACTIVA')`, [A, B, X]);
  await query(`INSERT INTO caja.metas_venta (caja_id, monto_meta) VALUES ($1, 300)`, [A]); // A tiene meta diaria
  const app = express();
  app.use(express.json());
  app.use("/api/kpis", (req, res, next) => { req.administrador = { administrador_id: "adm-1", nombre: "Admin Prueba" }; next(); }, rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis/metas-mensuales`;
  const prot = express();
  prot.use(express.json());
  prot.use("/api/kpis", requireAdministrador, rutas);
  prot.use(errorHandler);
  protegido = await new Promise((r) => { const s = prot.listen(0, () => r(s)); });
  baseProtegida = `http://localhost:${protegido.address().port}/api/kpis/metas-mensuales`;
});
test.after(async () => {
  servidor.close();
  protegido.close();
  await limpiar();
  await pool.end();
});

const poner = (metas) => fetch(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metas }) }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));
const leer = async () => (await (await fetch(base)).json()).data.cajas.filter((c) => [A, B, X].includes(c.caja_id));

test("la meta mensual: hasta 2 decimales, mayor a 0 y con un tope; vacios y textos se rechazan", () => {
  assert.equal(errorDeMonto(10000), null);
  assert.equal(errorDeMonto("10000.50"), null);
  assert.equal(errorDeMonto(0.01), null);
  for (const malo of [0, -5, "abc", NaN, Infinity, null, undefined, "", true, 10.123, MONTO_MAXIMO + 1]) assert.ok(errorDeMonto(malo), String(malo));
});

test("GET: una fila por caja ACTIVA con su meta mensual (null si no tiene) y su meta diaria; la inactiva no aparece", async () => {
  const lista = await leer();
  assert.deepEqual(lista.map((c) => [c.caja_id, c.caja_nombre, c.monto_mensual, c.meta_diaria]), [[A, "T200 A", null, 300], [B, "T200 B", null, null]]);
});

test("PUT: guarda la meta mensual de varias cajas, con quien la cambio, y las devuelve", async () => {
  const { status, cuerpo } = await poner([{ caja_id: A, monto_mensual: 10000 }, { caja_id: B, monto_mensual: "8500.50" }]);
  assert.equal(status, 200);
  const mias = cuerpo.data.cajas.filter((c) => [A, B].includes(c.caja_id));
  assert.deepEqual(mias.map((c) => [c.caja_id, c.monto_mensual, c.actualizado_por]), [[A, 10000, "Admin Prueba"], [B, 8500.5, "Admin Prueba"]]);
  assert.deepEqual((await leer()).map((c) => c.monto_mensual), [10000, 8500.5]);
});

test("PUT: volver a guardar una caja REEMPLAZA su meta (una sola fila por caja) y no toca a las demas", async () => {
  await poner([{ caja_id: A, monto_mensual: 12000 }]);
  assert.deepEqual((await leer()).map((c) => c.monto_mensual), [12000, 8500.5]);
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM caja.metas_mensuales WHERE caja_id = $1`, [A]);
  assert.equal(rows[0].n, 1);
});

test("PUT: si UNA meta es invalida no se guarda NINGUNA y cada error trae su campo", async () => {
  const antes = (await leer()).map((c) => c.monto_mensual);
  const { status, cuerpo } = await poner([{ caja_id: A, monto_mensual: 99999 }, { caja_id: B, monto_mensual: 0 }, { caja_id: X, monto_mensual: 100 }, { caja_id: "NO-EXISTE", monto_mensual: 5 }, { caja_id: A, monto_mensual: 7 }]);
  assert.equal(status, 400);
  const e = Object.fromEntries(cuerpo.detalle.errores.map((x) => [x.campo, x.mensaje]));
  assert.match(e[`metas_cajas.${B}`], /mayor a 0/);
  assert.match(e[`metas_cajas.${X}`], /no existe o no está activa/); // inactiva
  assert.match(e["metas_cajas.NO-EXISTE"], /no existe/);
  assert.match(e[`metas_cajas.${A}`], /repetida/);
  assert.deepEqual((await leer()).map((c) => c.monto_mensual), antes); // nada cambio, ni la valida
});

test("PUT: sin metas, o sin lista, es 400", async () => {
  assert.equal((await poner([])).status, 400);
  assert.equal((await poner(undefined)).status, 400);
  assert.equal((await poner("hola")).status, 400);
});

test("solo el administrador: sin token 401 (GET y PUT)", async () => {
  assert.equal((await fetch(baseProtegida)).status, 401);
  assert.equal((await fetch(baseProtegida, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metas: [{ caja_id: A, monto_mensual: 1 }] }) })).status, 401);
  assert.deepEqual((await leer()).map((c) => c.monto_mensual), [12000, 8500.5]); // el PUT sin token no cambio nada
});

test("la meta mensual guardada es la que usa el cumplimiento de metas (gana a la diaria)", async () => {
  const { metaDelMes } = require("../services/kpiMetasService");
  const [a] = await leer();
  assert.deepEqual(metaDelMes(a.monto_mensual, a.meta_diaria, 30), { monto: 1200000, origen: "mensual" }); // 12000, no 300 x 30
});
