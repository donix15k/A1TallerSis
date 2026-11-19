// TDSI-149: GET /api/kpis/devoluciones (monto devuelto y % por motivo del periodo). BD real: las devoluciones de prueba se insertan
// DIRECTO en un mes lejano (abril de 2006) con su historial y se borran al terminar. El administrador se valida contra un Caja local.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { devolucionesDelPeriodo } = require("../services/kpiService");
const { rangoDelPeriodo } = require("../utils/periodo");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivos; // nombre -> id
const FACTURA = "F-KPI149";

/** Una devolucion en el estado dado; si es PROCESADA lleva su evento de historial en la fecha indicada (hora de Bolivia). */
async function devolucion(codigo, motivo, monto, estado, procesadaEn = null) {
  const { rows } = await query(
    `INSERT INTO devoluciones.devoluciones (codigo, factura_numero, fecha_venta, fecha_solicitud, dentro_de_plazo, tipo, motivo_id, metodo_pago_original, monto_total, estado, creado_por)
     VALUES ($1, $2, '2006-03-01T00:00:00Z', '2006-03-02T00:00:00Z', true, 'PARCIAL', $3, 'QR', $4, $5, 'cajero.kpi') RETURNING id`,
    [codigo, FACTURA, motivos[motivo] ?? null, monto, estado]
  );
  if (procesadaEn) {
    await query(`INSERT INTO devoluciones.historial_estados (devolucion_id, estado_anterior, estado_nuevo, cambiado_por, cambiado_en) VALUES ($1, 'APROBADA', 'PROCESADA', 'cajero.kpi', $2::timestamptz)`, [rows[0].id, procesadaEn]);
  }
}

test.before(async () => {
  entorno = await iniciarEntorno();
  motivos = Object.fromEntries((await entorno.get("/api/devoluciones/motivos")).cuerpo.data.map((m) => [m.nombre, m.id]));
  // abril de 2006: Producto defectuoso 45 + 45 = 90 (2), Producto equivocado 50 (1), Otro 10 (1) -> total 150
  await devolucion("KPI149-1", "Producto defectuoso", 45, "PROCESADA", "2006-04-01 00:30:00-04"); // primer dia, 00:30 Bolivia
  await devolucion("KPI149-2", "Producto defectuoso", 45, "PROCESADA", "2006-04-15 10:00:00-04");
  await devolucion("KPI149-3", "Producto equivocado", 50, "PROCESADA", "2006-04-20 10:00:00-04");
  await devolucion("KPI149-4", "Otro", 10, "PROCESADA", "2006-04-30 23:30:00-04"); // ultimo dia, 23:30 Bolivia (03:30Z del 1/5)
  // NO cuentan: sin reembolsar, de otro mes (procesadas en marzo y mayo) y rechazada
  await devolucion("KPI149-5", "Otro", 999, "APROBADA");
  await devolucion("KPI149-6", "Otro", 999, "PROCESADA", "2006-03-31 23:50:00-04");
  await devolucion("KPI149-7", "Otro", 999, "PROCESADA", "2006-05-01 00:10:00-04");
  await devolucion("KPI149-8", "Otro", 999, "RECHAZADA");
});
test.after(async () => {
  await query(`DELETE FROM devoluciones.devoluciones WHERE factura_numero = $1`, [FACTURA]);
  await entorno.cerrar();
});

test("periodo: el mes completo en hora de Bolivia, y el invalido da 400", () => {
  assert.deepEqual(rangoDelPeriodo("2006-04"), { periodo: "2006-04", desde: "2006-04-01", hasta: "2006-04-30" });
  assert.equal(rangoDelPeriodo(undefined, { ahora: new Date("2026-12-01T02:00:00Z") }).periodo, "2026-11");
  for (const malo of ["2006-13", "abril", "2006-4", "2006-04-01"]) assert.throws(() => rangoDelPeriodo(malo), (e) => e.status === 400, malo);
});

test("el monto devuelto del mes y el reparto por motivo, de mayor a menor, con su porcentaje", async () => {
  const d = await devolucionesDelPeriodo({ periodo: "2006-04" });
  assert.deepEqual([d.periodo, d.desde, d.hasta, d.monto_devuelto, d.cantidad], ["2006-04", "2006-04-01", "2006-04-30", 150, 4]);
  assert.deepEqual(d.motivos.map((m) => [m.motivo, m.cantidad, m.monto, m.porcentaje]), [
    ["Producto defectuoso", 2, 90, 60],
    ["Producto equivocado", 1, 50, 33.33],
    ["Otro", 1, 10, 6.67],
  ]);
  const montos = d.motivos.map((m) => m.monto);
  assert.deepEqual(montos, [...montos].sort((a, b) => b - a));
});

test("solo cuentan las PROCESADAS en el mes en que se procesaron (hora de Bolivia): ni aprobadas, ni rechazadas, ni de otro mes", async () => {
  const d = await devolucionesDelPeriodo({ periodo: "2006-04" });
  assert.equal(d.monto_devuelto, 150); // sin los 999 de las otras
  assert.equal((await devolucionesDelPeriodo({ periodo: "2006-03" })).monto_devuelto, 999); // KPI149-6 (23:50 del 31/03)
  assert.equal((await devolucionesDelPeriodo({ periodo: "2006-05" })).monto_devuelto, 999); // KPI149-7 (00:10 del 1/05)
});

test("un mes sin devoluciones: monto 0, lista vacia (nunca NaN)", async () => {
  const d = await devolucionesDelPeriodo({ periodo: "2006-08" });
  assert.deepEqual([d.monto_devuelto, d.cantidad, d.motivos], [0, 0, []]);
});

test("por HTTP: solo el administrador (sin token 401, cajero 403) y con token trae el reporte", async () => {
  const pedir = (qs, token) => fetch(`${entorno.base}/api/kpis/devoluciones${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));
  assert.equal((await pedir("?periodo=2006-04", null)).status, 401);
  assert.equal((await pedir("?periodo=2006-04", "CAJERO-TEST")).status, 403);
  const ok = await pedir("?periodo=2006-04", entorno.TOKEN_ADMIN);
  assert.equal(ok.status, 200);
  assert.equal(ok.cuerpo.data.monto_devuelto, 150);
  assert.equal(ok.cuerpo.data.motivos[0].motivo, "Producto defectuoso");
  assert.equal((await pedir("?periodo=2006-13", entorno.TOKEN_ADMIN)).status, 400);
  assert.match((await pedir("", entorno.TOKEN_ADMIN)).cuerpo.data.periodo, /^\d{4}-\d{2}$/); // sin periodo: mes actual
});
