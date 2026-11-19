// TDSI-50: el efectivo esperado del turno descuenta las salidas de efectivo por devoluciones.
// BD real y gestion_pagos (GESTION_PAGOS_URL) para las ventas; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { compararEfectivo, calcularTotalRecaudado, generarReporteCierre } = require("../services/cierreService");
const { registrarMovimiento } = require("../services/movimientoService");

const SUF = String(Date.now()).slice(-8);
const CAJA = "CAJA-T50";
let turnoId;
let turnoSinDevId;

test.before(async () => {
  await query(`INSERT INTO caja.cajas (codigo, nombre, estado) VALUES ($1, 'Caja Test 50', 'ACTIVA') ON CONFLICT (codigo) DO NOTHING`, [CAJA]);
  const t = await query(
    `INSERT INTO caja.turnos (codigo, caja_id, cajero_id, cajero_nombre, efectivo_inicial)
     VALUES ($1, $2, 'cajero.t50@tallersis.test', 'Cajero T50', 100) RETURNING id`,
    [`T50A-${SUF}`, CAJA]
  );
  turnoId = Number(t.rows[0].id);
  // venta en efectivo de Bs 50 y una de QR de Bs 80, dentro del turno
  await query(
    `INSERT INTO pagos.transacciones (id_transaccion, metodo, monto, tipo_pago, caja_id, estado, fecha)
     VALUES ('T50-1', 'Efectivo', 50, 'Simple', $1, 'Registrado', now() + interval '1 second'),
            ('T50-2', 'QR', 80, 'Simple', $1, 'Registrado', now() + interval '1 second')`,
    [CAJA]
  );
  await new Promise((r) => setTimeout(r, 1200));
});

test.after(async () => {
  await query(`DELETE FROM pagos.transacciones WHERE id_transaccion LIKE 'T50-%'`);
  await query(`DELETE FROM caja.turnos WHERE caja_id = $1`, [CAJA]);
  await query(`DELETE FROM caja.cajas WHERE codigo = $1`, [CAJA]);
});

const salida = (codigo, monto) => registrarMovimiento(turnoId, {
  tipo: "EGRESO", metodo: "Efectivo", monto, origen_microservicio: "DEVOLUCIONES", referencia_externa: codigo, descripcion: `Devolución ${codigo}`,
});

test("sin devoluciones: esperado = inicial + ventas en efectivo (100 + 50), egresos 0", async () => {
  const r = await compararEfectivo(turnoId, 150);
  assert.equal(r.efectivoEsperado, 150);
  assert.equal(r.egresosEfectivo, 0);
  assert.equal(r.tipoDiferencia, "CUADRA");
});

test("con salidas por devolucion: esperado = inicial + ventas - salidas (100 + 50 - 30 - 12.5 = 107.5)", async () => {
  await salida(`DEV-${SUF}1`, 30);
  await salida(`DEV-${SUF}2`, 12.5);
  const r = await compararEfectivo(turnoId, 107.5);
  assert.equal(r.ventasEfectivo, 50);
  assert.equal(r.egresosEfectivo, 42.5);
  assert.equal(r.efectivoEsperado, 107.5);
  assert.equal(r.tipoDiferencia, "CUADRA");

  // si el cajero cuenta lo que habria SIN descontar las devoluciones, le sobra: ya no cuadra
  const sobra = await compararEfectivo(turnoId, 150);
  assert.equal(sobra.tipoDiferencia, "SOBRANTE");
  assert.equal(sobra.diferencia, 42.5);
});

test("el total recaudado muestra los egresos en Efectivo y el neto; Tarjeta y QR no cambian", async () => {
  const r = await calcularTotalRecaudado(turnoId);
  assert.equal(r.porMetodo.Efectivo.egresos, 42.5);
  assert.equal(r.porMetodo.Efectivo.neto, 7.5);
  assert.equal(r.porMetodo.QR.egresos, 0);
  assert.equal(r.porMetodo.QR.neto, 80);
  assert.equal(r.totalIngresos, 130);
  assert.equal(r.totalEgresos, 42.5);
  assert.equal(r.totalRecaudado, 87.5);
});

test("el reporte de cierre incluye los egresos y el arqueo con el esperado ya descontado", async () => {
  const rep = await generarReporteCierre(turnoId, 107.5);
  assert.equal(rep.totalEgresos, 42.5);
  assert.equal(rep.arqueoEfectivo.efectivoEsperado, 107.5);
  assert.equal(rep.arqueoEfectivo.egresosEfectivo, 42.5);
});

test("las salidas de OTRO turno no se descuentan", async () => {
  const otro = await query(
    `INSERT INTO caja.turnos (codigo, caja_id, cajero_id, cajero_nombre, efectivo_inicial, estado, cerrado_en)
     VALUES ($1, $2, 'otro@tallersis.test', 'Otro', 10, 'CERRADO', now()) RETURNING id`,
    [`T50B-${SUF}`, CAJA]
  );
  turnoSinDevId = Number(otro.rows[0].id);
  const r = await calcularTotalRecaudado(turnoSinDevId);
  assert.equal(r.totalEgresos, 0);
});
