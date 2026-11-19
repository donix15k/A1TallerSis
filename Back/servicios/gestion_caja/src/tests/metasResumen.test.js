// TDSI-139: GET /api/metas/resumen (meta diaria total de las cajas activas con meta). BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { query } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const { resumenMetas } = require("../services/metasVentaService");

const A = "CAJA-T139A";
const B = "CAJA-T139B";
const C = "CAJA-T139C"; // inactiva
let servidor, base;

test.before(async () => {
  await query(`DELETE FROM caja.metas_venta WHERE caja_id = ANY($1)`, [[A, B, C]]);
  await query(`DELETE FROM caja.cajas WHERE codigo = ANY($1)`, [[A, B, C]]);
  await query(`INSERT INTO caja.cajas (codigo, nombre, estado) VALUES ($1, 'T139 A', 'ACTIVA'), ($2, 'T139 B', 'ACTIVA'), ($3, 'T139 C', 'INACTIVA')`, [A, B, C]);
  const app = express();
  app.use(express.json());
  app.use("/api/metas", require("../routes/metasVentaRoutes"));
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/metas/resumen`;
});
test.after(async () => {
  servidor.close();
  await query(`DELETE FROM caja.metas_venta WHERE caja_id = ANY($1)`, [[A, B, C]]);
  await query(`DELETE FROM caja.cajas WHERE codigo = ANY($1)`, [[A, B, C]]);
});

const mias = (r) => r.cajas.filter((c) => [A, B, C].includes(c.caja_id));

test("suma la meta de las cajas ACTIVAS con meta (una inactiva no cuenta)", async () => {
  const antes = await resumenMetas();
  const sumaAntes = antes.meta_diaria_total ?? 0;
  await query(`INSERT INTO caja.metas_venta (caja_id, monto_meta) VALUES ($1, 500), ($2, 250.5), ($3, 999)`, [A, B, C]);
  const r = await (await fetch(base)).json();
  assert.equal(r.ok, true);
  assert.deepEqual(mias(r.data).map((c) => [c.caja_id, c.monto_meta]).sort(), [[A, 500], [B, 250.5]]);
  assert.equal(Math.round((r.data.meta_diaria_total - sumaAntes) * 100), 75050); // +500 +250,50 y nada de la inactiva
  assert.ok(r.data.cajas_con_meta >= 2 && r.data.cajas_activas >= 2);
});

test("una caja activa SIN meta no suma ni cuenta como caja con meta", async () => {
  await query(`DELETE FROM caja.metas_venta WHERE caja_id = $1`, [B]);
  const r = await resumenMetas();
  assert.ok(!mias(r).some((c) => c.caja_id === B));
  assert.ok(r.cajas_activas > r.cajas_con_meta || r.cajas_con_meta >= 1);
});
