// TDSI-169/170/171: GET /api/kpis/cuadre-caja. BD real: turnos de prueba insertados DIRECTO en meses lejanos (abril, junio y julio de
// 2000) y borrados al terminar. La proteccion de administrador se prueba con el middleware real (sin token 401).
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const { requireAdministrador } = require("../middlewares/requireAdministrador");
const rutas = require("../routes/kpiRoutes");
const { cuadreCaja, colorCuadre, UMBRALES_CUADRE } = require("../services/kpiCuadreService");

const CAJA = "CAJA-T169A"; // existe en caja.cajas
const SIN_CAJA = "CAJA-T169X"; // NO existe: el nombre cae al codigo
let servidor, base, protegido, baseProtegida;
let n = 0;

/** Un turno cerrado en la fecha dada (hora de Bolivia). tipo null = cerrado sin arqueo; estado ABIERTO = sigue abierto. */
async function turno({ tipo, diferencia = 0, cerrado, caja = CAJA, cajero = "cajero169", nombre = null, estado = "CERRADO" }) {
  n += 1;
  await query(
    `INSERT INTO caja.turnos (codigo, caja_id, cajero_id, cajero_nombre, diferencia, tipo_diferencia, estado, abierto_en, cerrado_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $8::timestamptz)`,
    [`T169-${String(n).padStart(4, "0")}`, caja, cajero, nombre, tipo ? diferencia : null, tipo, estado, cerrado]
  );
}

async function limpiar() {
  await query(`DELETE FROM caja.turnos WHERE codigo LIKE 'T169-%'`);
  await query(`DELETE FROM caja.cajas WHERE codigo = $1`, [CAJA]);
}

test.before(async () => {
  await limpiar();
  await query(`INSERT INTO caja.cajas (codigo, nombre, estado) VALUES ($1, 'Terminal T169', 'ACTIVA')`, [CAJA]);

  // abril de 2000: 20 turnos cerrados con arqueo -> 17 CUADRA + 2 FALTANTE (-22,00 y -10,50) + 1 SOBRANTE (30,25) = 85 % (AMARILLO)
  for (let i = 0; i < 17; i++) await turno({ tipo: "CUADRA", cerrado: `2000-04-${String(2 + i).padStart(2, "0")} 20:00:00-04` });
  await turno({ tipo: "FALTANTE", diferencia: -22, cerrado: "2000-04-20 21:00:00-04", nombre: "Sofia T." });
  await turno({ tipo: "FALTANTE", diferencia: -10.5, cerrado: "2000-04-21 21:00:00-04", caja: SIN_CAJA, cajero: "ana@x.com" });
  await turno({ tipo: "SOBRANTE", diferencia: 30.25, cerrado: "2000-04-30 23:30:00-04", nombre: "Beto R." }); // 03:30Z del 1/5: sigue siendo abril
  // NO cuentan: fuera del mes (hora de Bolivia), cerrado sin arqueo y todavia abierto
  await turno({ tipo: "FALTANTE", diferencia: -999, cerrado: "2000-03-31 23:50:00-04" });
  await turno({ tipo: "FALTANTE", diferencia: -999, cerrado: "2000-05-01 00:10:00-04" });
  await turno({ tipo: null, cerrado: "2000-04-15 10:00:00-04" });
  await turno({ tipo: null, cerrado: "2000-04-16 10:00:00-04", estado: "ABIERTO" });

  // junio de 2000: 19 CUADRA + 1 FALTANTE = 95 % justo -> VERDE; julio de 2000: 5 CUADRA + 1 SOBRANTE = 83,33 % -> ROJO
  for (let i = 0; i < 19; i++) await turno({ tipo: "CUADRA", cerrado: `2000-06-${String(1 + i).padStart(2, "0")} 20:00:00-04` });
  await turno({ tipo: "FALTANTE", diferencia: -5, cerrado: "2000-06-25 20:00:00-04" });
  for (let i = 0; i < 5; i++) await turno({ tipo: "CUADRA", cerrado: `2000-07-${String(1 + i).padStart(2, "0")} 20:00:00-04` });
  await turno({ tipo: "SOBRANTE", diferencia: 12, cerrado: "2000-07-10 20:00:00-04" });

  const app = express();
  app.use(express.json());
  app.use("/api/kpis", rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis/cuadre-caja`;

  const prot = express();
  prot.use("/api/kpis", requireAdministrador, rutas);
  prot.use(errorHandler);
  protegido = await new Promise((r) => { const s = prot.listen(0, () => r(s)); });
  baseProtegida = `http://localhost:${protegido.address().port}/api/kpis/cuadre-caja`;
});
test.after(async () => {
  servidor.close();
  protegido.close();
  await limpiar();
  await pool.end();
});

const pedir = (qs = "?periodo=2000-04") => fetch(`${base}${qs}`).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

test("semaforo: VERDE desde 95 %, AMARILLO de 85 a 94,99 %, ROJO por debajo de 85 %", () => {
  const casos = [[100, "VERDE"], [95, "VERDE"], [94.99, "AMARILLO"], [85, "AMARILLO"], [84.99, "ROJO"], [82.6, "ROJO"], [0, "ROJO"]];
  for (const [pct, color] of casos) assert.equal(colorCuadre(pct), color, String(pct));
  assert.deepEqual(UMBRALES_CUADRE, { verde: 95, amarillo: 85 });
});

test("turnos cerrados, los que cuadran, el % y su color (17 de 20 = 85 %, AMARILLO)", async () => {
  const { status, cuerpo } = await pedir();
  assert.equal(status, 200);
  const d = cuerpo.data;
  assert.deepEqual([d.periodo, d.desde, d.hasta], ["2000-04", "2000-04-01", "2000-04-30"]);
  assert.deepEqual([d.turnos_cerrados, d.turnos_cuadran, d.porcentaje, d.color, d.sin_turnos], [20, 17, 85, "AMARILLO", false]);
  assert.deepEqual(d.umbrales, { verde: 95, amarillo: 85 });
});

test("el 95 % justo es VERDE y el 83,33 % es ROJO", async () => {
  const junio = (await pedir("?periodo=2000-06")).cuerpo.data;
  assert.deepEqual([junio.turnos_cerrados, junio.turnos_cuadran, junio.porcentaje, junio.color], [20, 19, 95, "VERDE"]);
  const julio = (await pedir("?periodo=2000-07")).cuerpo.data;
  assert.deepEqual([julio.turnos_cerrados, julio.turnos_cuadran, julio.porcentaje, julio.color], [6, 5, 83.33, "ROJO"]);
});

test("solo cuentan los turnos CERRADOS con arqueo y cuyo cierre cae en el mes (hora de Bolivia)", async () => {
  const d = (await pedir()).cuerpo.data;
  assert.equal(d.turnos_cerrados, 20); // sin los dos de otro mes, ni el cerrado sin arqueo, ni el que sigue abierto
  assert.ok(!d.turnos_con_diferencia.some((t) => t.diferencia === -999));
  assert.equal((await pedir("?periodo=2000-03")).cuerpo.data.faltantes, 999); // el del 31/03 23:50
  assert.equal((await pedir("?periodo=2000-05")).cuerpo.data.faltantes, 999); // el del 1/05 00:10
});

test("total de SOBRANTES y de FALTANTES del mes en Bs (siempre positivos)", async () => {
  const d = (await pedir()).cuerpo.data;
  assert.deepEqual([d.sobrantes, d.faltantes], [30.25, 32.5]); // 22 + 10,50
});

test("los turnos con diferencia: turno, caja, cajero, monto y SOBRANTE/FALTANTE, el de mayor monto primero", async () => {
  const d = (await pedir()).cuerpo.data;
  assert.deepEqual(d.turnos_con_diferencia.map((t) => [t.caja_nombre, t.cajero, t.diferencia, t.tipo]), [
    ["Terminal T169", "Beto R.", 30.25, "SOBRANTE"],
    ["Terminal T169", "Sofia T.", -22, "FALTANTE"],
    [SIN_CAJA, "ana@x.com", -10.5, "FALTANTE"], // sin fila en caja.cajas: el nombre cae al codigo; sin nombre de cajero: su id
  ]);
  assert.match(d.turnos_con_diferencia[0].turno, /^T169-\d{4}$/);
  assert.ok(d.turnos_con_diferencia.every((t) => t.turno_id && t.cerrado_en && t.caja_id));
});

test("los ultimos turnos cerrados con su estado, del mas reciente al mas antiguo (5 por defecto, ?ultimos= hasta 20)", async () => {
  const d = (await pedir()).cuerpo.data;
  assert.equal(d.ultimos_turnos.length, 5);
  assert.deepEqual(d.ultimos_turnos.slice(0, 3).map((t) => [t.tipo, t.diferencia]), [["SOBRANTE", 30.25], ["FALTANTE", -10.5], ["FALTANTE", -22]]);
  assert.ok(d.ultimos_turnos.every((t, i, a) => i === 0 || new Date(a[i - 1].cerrado_en) >= new Date(t.cerrado_en)));
  assert.equal((await pedir("?periodo=2000-04&ultimos=2")).cuerpo.data.ultimos_turnos.length, 2);
  assert.equal((await pedir("?periodo=2000-04&ultimos=20")).cuerpo.data.ultimos_turnos.length, 20);
  for (const malo of ["0", "21", "x", "1.5"]) assert.equal((await pedir(`?periodo=2000-04&ultimos=${malo}`)).status, 400, malo);
});

test("un mes sin turnos cerrados: porcentaje y color null (no hay nada que evaluar), totales en 0 y listas vacias", async () => {
  const d = (await pedir("?periodo=2000-09")).cuerpo.data;
  assert.deepEqual([d.turnos_cerrados, d.turnos_cuadran, d.porcentaje, d.color, d.sin_turnos, d.sobrantes, d.faltantes], [0, 0, null, null, true, 0, 0]);
  assert.deepEqual([d.turnos_con_diferencia, d.ultimos_turnos], [[], []]);
});

test("periodo invalido 400; sin periodo usa el mes actual; sin token 401 (solo el administrador)", async () => {
  assert.equal((await pedir("?periodo=2000-13")).status, 400);
  const actual = await pedir("");
  assert.equal(actual.status, 200);
  assert.match(actual.cuerpo.data.periodo, /^\d{4}-\d{2}$/);
  assert.equal((await fetch(baseProtegida)).status, 401);
  assert.equal((await fetch(baseProtegida, { headers: { Authorization: "Bearer no-es-un-token" } })).status, 401);
});
