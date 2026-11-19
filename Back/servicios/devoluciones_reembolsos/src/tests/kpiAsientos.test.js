// TDSI-180: GET /api/kpis/asientos-contables (asientos de notas de credito enviados a Contabilidad en el periodo). BD real: las notas
// de prueba se insertan DIRECTO en un mes lejano (mayo de 2007) y se borran al terminar (la devolucion arrastra nota y envio).
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { asientosContablesDelPeriodo } = require("../services/kpiService");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
const FACTURA = "F-KPI180";
let n = 0;

/** Una nota de credito con su envio a Contabilidad. estado/enviado/resultado describen el envio. */
async function nota({ estado = "Enviado", enviado = null, resultado = null, motivo = null }) {
  n += 1;
  const dev = await query(
    `INSERT INTO devoluciones.devoluciones (codigo, factura_numero, fecha_venta, fecha_solicitud, dentro_de_plazo, tipo, metodo_pago_original, monto_total, estado, creado_por)
     VALUES ($1, $2, '2007-04-01T00:00:00Z', '2007-04-02T00:00:00Z', true, 'PARCIAL', 'QR', 10, 'PROCESADA', 'cajero.kpi') RETURNING id`,
    [`KPI180-${n}`, FACTURA]
  );
  const nc = await query(`INSERT INTO devoluciones.notas_credito (devolucion_id, numero, monto) VALUES ($1, $2, 10) RETURNING id`, [dev.rows[0].id, `NC-K180${String(n).padStart(2, "0")}`]);
  await query(
    `INSERT INTO devoluciones.envios_contabilidad_nc (nota_credito_id, idempotency_key, estado, enviado_en, payload, resultado, resultado_motivo)
     VALUES ($1, $2, $3, $4::timestamptz, '{}'::jsonb, $5, $6)`,
    [nc.rows[0].id, `nc-k180-${n}`, estado, enviado, resultado, motivo]
  );
}

test.before(async () => {
  entorno = await iniciarEntorno();
  // mayo de 2007: 5 enviadas -> 2 registradas, 1 aceptada (cuenta como registrada), 1 rechazada con motivo y 1 sin respuesta todavia
  await nota({ enviado: "2007-05-01 00:30:00-04", resultado: "registrado" }); // primer dia, 00:30 Bolivia
  await nota({ enviado: "2007-05-10 10:00:00-04", resultado: "registrado" });
  await nota({ enviado: "2007-05-12 10:00:00-04", resultado: "aceptado" });
  await nota({ enviado: "2007-05-31 23:30:00-04", resultado: "rechazado", motivo: "Cuenta contable inexistente" }); // ultimo dia, 03:30Z del 1/6
  await nota({ enviado: "2007-05-20 10:00:00-04" }); // sin respuesta: no cuenta como rechazada
  // NO cuentan: sin enviar (Pendiente / Error) y enviadas en otro mes (hora de Bolivia)
  await nota({ estado: "Pendiente" });
  await nota({ estado: "Error" });
  await nota({ enviado: "2007-04-30 23:50:00-04", resultado: "rechazado", motivo: "de abril" });
  await nota({ enviado: "2007-06-01 00:10:00-04", resultado: "rechazado", motivo: "de junio" });
});
test.after(async () => {
  await query(`DELETE FROM devoluciones.devoluciones WHERE factura_numero = $1`, [FACTURA]);
  await entorno.cerrar();
});

test("enviados, registrados (registrado o aceptado), rechazados y sin respuesta del mes", async () => {
  const d = await asientosContablesDelPeriodo({ periodo: "2007-05" });
  assert.deepEqual([d.periodo, d.desde, d.hasta], ["2007-05", "2007-05-01", "2007-05-31"]);
  assert.deepEqual([d.enviados, d.registrados, d.rechazados, d.sin_respuesta], [5, 3, 1, 1]);
});

test("la lista de rechazados trae la nota, su motivo y que es una NOTA_CREDITO", async () => {
  const d = await asientosContablesDelPeriodo({ periodo: "2007-05" });
  assert.equal(d.rechazados_lista.length, 1);
  const [r] = d.rechazados_lista;
  assert.deepEqual([r.referencia, r.tipo, r.motivo], [`NC-K18004`, "NOTA_CREDITO", "Cuenta contable inexistente"]);
  assert.ok(r.id && r.enviado_en);
});

test("solo cuentan los envios YA enviados y en el mes en hora de Bolivia (los limites del mes y otro mes quedan fuera)", async () => {
  assert.equal((await asientosContablesDelPeriodo({ periodo: "2007-04" })).rechazados_lista[0].motivo, "de abril");
  assert.equal((await asientosContablesDelPeriodo({ periodo: "2007-06" })).enviados, 1);
  assert.equal((await asientosContablesDelPeriodo({ periodo: "2007-05" })).enviados, 5); // sin Pendiente ni Error
});

test("un mes sin envios: todo en 0 y lista vacia", async () => {
  const d = await asientosContablesDelPeriodo({ periodo: "2007-09" });
  assert.deepEqual([d.enviados, d.registrados, d.rechazados, d.sin_respuesta, d.rechazados_lista], [0, 0, 0, 0, []]);
});

test("por HTTP: solo el administrador (sin token 401, cajero 403); periodo invalido 400", async () => {
  const pedir = (qs, token) => fetch(`${entorno.base}/api/kpis/asientos-contables${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));
  assert.equal((await pedir("?periodo=2007-05", null)).status, 401);
  assert.equal((await pedir("?periodo=2007-05", "CAJERO-TEST")).status, 403);
  const ok = await pedir("?periodo=2007-05", entorno.TOKEN_ADMIN);
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.cuerpo.data.enviados, ok.cuerpo.data.rechazados], [5, 1]);
  assert.equal((await pedir("?periodo=2007-13", entorno.TOKEN_ADMIN)).status, 400);
});
