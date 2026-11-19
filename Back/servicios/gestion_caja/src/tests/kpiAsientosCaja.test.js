// TDSI-180: GET /api/kpis/asientos-contables en Gestion de Caja (asientos de diferencias de caja enviados a Contabilidad). BD real:
// turnos, diferencias y envios de prueba insertados DIRECTO en un mes lejano (agosto de 2000) y borrados al terminar.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const { requireAdministrador } = require("../middlewares/requireAdministrador");
const rutas = require("../routes/kpiRoutes");
const { asientosContablesDelPeriodo } = require("../services/kpiAsientosService");

let servidor, base, protegido, baseProtegida;
let n = 0;
const ids = [];

/** Una diferencia con su envio a Contabilidad: estado y fecha de envio; motivo cuando la rechazaron. */
async function envio({ estado, enviado = null, motivo = null }) {
  n += 1;
  const turno = await query(`INSERT INTO caja.turnos (codigo, caja_id, cajero_id, estado) VALUES ($1, 'CAJA-T180', 'cajero180', 'CERRADO') RETURNING id`, [`T180-${n}`]);
  const dif = await query(`INSERT INTO caja.diferencias_resolucion (turno_id, monto, tipo, estado) VALUES ($1, 10, 'FALTANTE', 'RESUELTA') RETURNING id`, [turno.rows[0].id]);
  await query(`INSERT INTO caja.diferencias_envios_contabilidad (diferencia_id, estado, enviado_en, motivo_rechazo) VALUES ($1, $2, $3::timestamptz, $4)`, [dif.rows[0].id, estado, enviado, motivo]);
  ids.push(dif.rows[0].id);
  return dif.rows[0].id;
}
const limpiar = () => query(`DELETE FROM caja.turnos WHERE codigo LIKE 'T180-%'`); // arrastra diferencias y envios

let idRechazada;
test.before(async () => {
  await limpiar();
  // agosto de 2000: 5 enviadas -> 2 confirmadas, 1 rechazada con motivo, 2 sin respuesta (Enviado)
  await envio({ estado: "Confirmado", enviado: "2000-08-01 00:30:00-04" }); // primer dia, 00:30 Bolivia
  await envio({ estado: "Confirmado", enviado: "2000-08-10 10:00:00-04" });
  idRechazada = await envio({ estado: "Rechazado", enviado: "2000-08-31 23:30:00-04", motivo: "Cuenta de caja inexistente" }); // ultimo dia, 03:30Z del 1/9
  await envio({ estado: "Enviado", enviado: "2000-08-15 10:00:00-04" });
  await envio({ estado: "Enviado", enviado: "2000-08-16 10:00:00-04" });
  // NO cuentan: nunca salio (Pendiente) y enviadas en otro mes (hora de Bolivia)
  await envio({ estado: "Pendiente" });
  await envio({ estado: "Rechazado", enviado: "2000-07-31 23:50:00-04", motivo: "de julio" });
  await envio({ estado: "Rechazado", enviado: "2000-09-01 00:10:00-04", motivo: "de septiembre" });

  const app = express();
  app.use("/api/kpis", rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis/asientos-contables`;
  const prot = express();
  prot.use("/api/kpis", requireAdministrador, rutas);
  prot.use(errorHandler);
  protegido = await new Promise((r) => { const s = prot.listen(0, () => r(s)); });
  baseProtegida = `http://localhost:${protegido.address().port}/api/kpis/asientos-contables`;
});
test.after(async () => {
  servidor.close();
  protegido.close();
  await limpiar();
  await pool.end();
});

test("enviados, registrados (confirmados), rechazados y sin respuesta del mes", async () => {
  const d = await asientosContablesDelPeriodo({ periodo: "2000-08" });
  assert.deepEqual([d.periodo, d.desde, d.hasta], ["2000-08", "2000-08-01", "2000-08-31"]);
  assert.deepEqual([d.enviados, d.registrados, d.rechazados, d.sin_respuesta], [5, 2, 1, 2]);
});

test("la lista de rechazados: DIF-id, DIFERENCIA_CAJA y su motivo", async () => {
  const [r] = (await asientosContablesDelPeriodo({ periodo: "2000-08" })).rechazados_lista;
  assert.deepEqual([r.id, r.referencia, r.tipo, r.motivo], [String(idRechazada), `DIF-${idRechazada}`, "DIFERENCIA_CAJA", "Cuenta de caja inexistente"]);
});

test("solo cuentan los envios YA enviados y en el mes en hora de Bolivia", async () => {
  assert.equal((await asientosContablesDelPeriodo({ periodo: "2000-07" })).rechazados_lista[0].motivo, "de julio");
  assert.equal((await asientosContablesDelPeriodo({ periodo: "2000-09" })).rechazados_lista[0].motivo, "de septiembre");
});

test("un mes sin envios: todo en 0 y lista vacia", async () => {
  const d = await asientosContablesDelPeriodo({ periodo: "2000-12" });
  assert.deepEqual([d.enviados, d.registrados, d.rechazados, d.sin_respuesta, d.rechazados_lista], [0, 0, 0, 0, []]);
});

test("por HTTP: periodo invalido 400, sin periodo el mes actual y sin token 401 (solo el administrador)", async () => {
  const pedir = (qs) => fetch(`${base}${qs}`).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));
  assert.equal((await pedir("?periodo=2000-13")).status, 400);
  const ok = await pedir("?periodo=2000-08");
  assert.deepEqual([ok.status, ok.cuerpo.data.enviados], [200, 5]);
  assert.match((await pedir("")).cuerpo.data.periodo, /^\d{4}-\d{2}$/);
  assert.equal((await fetch(baseProtegida)).status, 401);
});
