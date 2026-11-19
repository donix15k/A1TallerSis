// TDSI-46: salida de efectivo por una devolucion (origen DEVOLUCIONES). BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { registrarMovimiento } = require("../services/movimientoService");

const CAJA_ID = "CAJA-TEST-46";
const SUFIJO = String(Date.now()).slice(-8);
let turnoId;
let turnoCerradoId;

test.before(async () => {
  await query(`INSERT INTO caja.cajas (codigo, nombre, estado) VALUES ($1, 'Caja Test 46', 'ACTIVA') ON CONFLICT (codigo) DO NOTHING`, [CAJA_ID]);
  const abierto = await query(
    `INSERT INTO caja.turnos (codigo, caja_id, cajero_id, cajero_nombre, efectivo_inicial)
     VALUES ($1, $2, 'cajero.devol@tallersis.test', 'Cajero Devoluciones', 200) RETURNING id`,
    [`TURNO-T46A-${SUFIJO}`.slice(0, 20), CAJA_ID]
  );
  turnoId = abierto.rows[0].id;
  const cerrado = await query(
    `INSERT INTO caja.turnos (codigo, caja_id, cajero_id, cajero_nombre, efectivo_inicial, estado, cerrado_en)
     VALUES ($1, $2, 'cajero.devol@tallersis.test', 'Cajero Devoluciones', 0, 'CERRADO', now()) RETURNING id`,
    [`TURNO-T46C-${SUFIJO}`.slice(0, 20), CAJA_ID]
  );
  turnoCerradoId = cerrado.rows[0].id;
});

test.after(async () => {
  await query(`DELETE FROM caja.turnos WHERE caja_id = $1`, [CAJA_ID]); // los movimientos caen en cascada
  await query(`DELETE FROM caja.cajas WHERE codigo = $1`, [CAJA_ID]);
});

const salida = (codigo, extra = {}) => ({
  tipo: "EGRESO", metodo: "Efectivo", monto: 40, origen_microservicio: "DEVOLUCIONES", referencia_externa: codigo, descripcion: `Devolución ${codigo}`, ...extra,
});

test("registra la salida de efectivo de una devolucion como EGRESO en Efectivo con origen DEVOLUCIONES", async () => {
  const codigo = `DEV-${SUFIJO}1`.slice(0, 14);
  const m = await registrarMovimiento(turnoId, salida(codigo));
  assert.equal(m.tipo, "EGRESO");
  assert.equal(m.metodo, "Efectivo");
  assert.equal(Number(m.monto), 40);
  assert.equal(m.origen_microservicio, "DEVOLUCIONES");
  assert.equal(m.referencia_externa, codigo);
  assert.equal(m.descripcion, `Devolución ${codigo}`);
  assert.equal(m.caja_id, CAJA_ID);
});

test("una devolucion solo saca efectivo una vez: repetirla da 409 y NO crea otro movimiento", async () => {
  const codigo = `DEV-${SUFIJO}2`.slice(0, 14);
  const primero = await registrarMovimiento(turnoId, salida(codigo));
  await assert.rejects(registrarMovimiento(turnoId, salida(codigo)), (e) => {
    assert.equal(e.status, 409);
    assert.match(e.message, /ya tiene registrada su salida de efectivo/);
    assert.equal(String(e.detalle.movimiento.id), String(primero.id)); // devuelve el movimiento que ya estaba
    return true;
  });
  const { rows } = await query(`SELECT count(*)::int n FROM caja.movimientos WHERE origen_microservicio = 'DEVOLUCIONES' AND referencia_externa = $1`, [codigo]);
  assert.equal(rows[0].n, 1);
});

test("dos pedidos simultaneos de la misma devolucion: solo uno registra la salida", async () => {
  const codigo = `DEV-${SUFIJO}3`.slice(0, 14);
  const resultados = await Promise.allSettled([registrarMovimiento(turnoId, salida(codigo)), registrarMovimiento(turnoId, salida(codigo))]);
  assert.deepEqual(resultados.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(resultados.find((r) => r.status === "rejected").reason.status, 409);
  const { rows } = await query(`SELECT count(*)::int n FROM caja.movimientos WHERE referencia_externa = $1`, [codigo]);
  assert.equal(rows[0].n, 1);
});

test("un movimiento de DEVOLUCIONES debe ser EGRESO en Efectivo y llevar el codigo DEV-NNNN", async () => {
  const codigo = `DEV-${SUFIJO}4`.slice(0, 14);
  await assert.rejects(registrarMovimiento(turnoId, salida(codigo, { tipo: "INGRESO" })), (e) => e.status === 400 && /EGRESO en Efectivo/.test(e.message));
  await assert.rejects(registrarMovimiento(turnoId, salida(codigo, { metodo: "QR" })), (e) => e.status === 400);
  for (const malo of [undefined, "", "F-000012", "dev 1", "DEV-"]) {
    await assert.rejects(registrarMovimiento(turnoId, salida(malo)), (e) => e.status === 400 && /codigo de la devolucion/.test(e.message), String(malo));
  }
});

test("con el turno cerrado no se puede sacar efectivo (423) y un turno inexistente da 404", async () => {
  await assert.rejects(registrarMovimiento(turnoCerradoId, salida(`DEV-${SUFIJO}5`.slice(0, 14))), (e) => e.status === 423);
  await assert.rejects(registrarMovimiento(999999999, salida(`DEV-${SUFIJO}6`.slice(0, 14))), (e) => e.status === 404);
});

test("un origen desconocido es un 400 claro (antes habria sido un error 500 de la base)", async () => {
  await assert.rejects(
    registrarMovimiento(turnoId, { tipo: "EGRESO", metodo: "Efectivo", monto: 5, origen_microservicio: "OTRO" }),
    (e) => e.status === 400 && /Origen no valido/.test(e.message)
  );
});

test("los movimientos de los otros origenes siguen igual (LOCAL por defecto, sin unicidad por referencia)", async () => {
  const a = await registrarMovimiento(turnoId, { tipo: "INGRESO", metodo: "Efectivo", monto: 10, referencia_externa: "REF-X" });
  const b = await registrarMovimiento(turnoId, { tipo: "INGRESO", metodo: "Efectivo", monto: 10, referencia_externa: "REF-X" });
  assert.equal(a.origen_microservicio, "LOCAL");
  assert.notEqual(String(a.id), String(b.id));
});
