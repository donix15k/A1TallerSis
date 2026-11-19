// TDSI-181/182: GET /api/kpis/dias-pago-proveedores. BD real: ordenes de prueba insertadas DIRECTO en meses lejanos (2000) y borradas
// al terminar; la validacion de administrador es un Gestion de Caja local (stub HTTP).
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const { requireAdministrador } = require("../middlewares/requireAdministrador");
const rutas = require("../routes/kpiRoutes");
const { diasPagoProveedores, colorDiasPago, UMBRALES_DIAS_PAGO } = require("../services/kpiDiasPagoService");

let caja, servidor, base;
let n = 0;

/** Una orden aprobada (creada) el dia dado y, si se indica, pagada (liquidada) en otra fecha. Fechas con hora de Bolivia. */
async function orden({ creada, pagada = null, monto = 100, proveedor = "Proveedor T181" }) {
  n += 1;
  await pool.query(
    `INSERT INTO proveedores.ordenes_pago
       (numero, orden_compra_id, proveedor_nit, proveedor_razon_social, proveedor_cuenta_bancaria, proveedor_banco, monto, estado, creado_en, liquidada_en)
     VALUES ($1, $2, '1', $3, '10', 'Banco', $4, $5, $6::timestamptz, $7::timestamptz)`,
    [`T181-${String(n).padStart(3, "0")}`, `OC-T181-${n}`, proveedor, monto, pagada ? "LIQUIDADA" : "PENDIENTE", creada, pagada]
  );
}
const limpiar = () => pool.query(`DELETE FROM proveedores.ordenes_pago WHERE numero LIKE 'T181-%'`);

test.before(async () => {
  await limpiar();
  caja = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if ((req.headers.authorization || "") === "Bearer ADMIN") return res.end(JSON.stringify({ ok: true, data: { administrador_id: "A" } }));
    res.statusCode = (req.headers.authorization || "") === "Bearer CAJERO" ? 403 : 401;
    res.end(JSON.stringify({ ok: false, mensaje: "no" }));
  });
  await new Promise((r) => caja.listen(0, r));
  process.env.ADMIN_VERIFICAR_URL = `http://localhost:${caja.address().port}`;

  // abril de 2000: tres ordenes PAGADAS en el mes con 4, 6 y 8 dias -> promedio 6,0 (VERDE)
  await orden({ creada: "2000-04-01 10:00:00-04", pagada: "2000-04-05 10:00:00-04", monto: 500, proveedor: "Insumos del Sur" });
  await orden({ creada: "2000-04-02 10:00:00-04", pagada: "2000-04-08 10:00:00-04", monto: 250.5 });
  await orden({ creada: "2000-03-25 10:00:00-04", pagada: "2000-04-02 10:00:00-04" }); // aprobada en marzo, pagada en abril: 8 dias
  await orden({ creada: "2000-04-10 10:00:00-04", pagada: "2000-05-01 00:10:00-04" }); // pagada ya en mayo (hora de Bolivia): no cuenta
  await orden({ creada: "2000-03-01 10:00:00-04", pagada: "2000-03-31 23:50:00-04" }); // pagada en marzo: no cuenta
  // PENDIENTES: creadas hasta fin de abril entran a las vencidas si pasan de 15 dias; la de mayo no
  await orden({ creada: "2000-04-05 10:00:00-04", monto: 3450, proveedor: "Distribuidora Andina" });
  await orden({ creada: "2000-04-28 10:00:00-04" });
  await orden({ creada: "2000-03-01 10:00:00-04", monto: 77 }); // de antes del periodo y aun sin pagar: sigue vencida
  await orden({ creada: "2000-05-10 10:00:00-04" }); // creada despues del fin de abril: no es de este periodo

  // junio de 2000: una sola orden pagada en 12 dias -> AMARILLO; julio: una de 20 dias -> ROJO
  await orden({ creada: "2000-06-01 10:00:00-04", pagada: "2000-06-13 10:00:00-04" });
  await orden({ creada: "2000-06-01 10:00:00-04", pagada: "2000-07-21 10:00:00-04" });

  const app = express();
  app.use("/api/kpis", requireAdministrador, rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis/dias-pago-proveedores`;
});
test.after(async () => {
  servidor.close();
  caja.close();
  delete process.env.ADMIN_VERIFICAR_URL;
  await limpiar();
  await pool.end();
});

const pedir = (qs = "?periodo=2000-04", token = "ADMIN") => fetch(`${base}${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));
const AHORA = new Date("2000-04-30T12:00:00Z"); // 30/04 08:00 en Bolivia

test("semaforo: VERDE hasta 7 dias, AMARILLO por encima de 7 y hasta 15, ROJO por encima de 15", () => {
  const casos = [[0, "VERDE"], [5.8, "VERDE"], [7, "VERDE"], [7.1, "AMARILLO"], [8, "AMARILLO"], [15, "AMARILLO"], [15.1, "ROJO"], [30, "ROJO"]];
  for (const [d, color] of casos) assert.equal(colorDiasPago(d), color, String(d));
  assert.deepEqual(UMBRALES_DIAS_PAGO, { verde: 7, amarillo: 15 });
});

test("el promedio de dias entre la aprobacion y el pago de las ordenes pagadas del mes, con su color", async () => {
  const { status, cuerpo } = await pedir();
  assert.equal(status, 200);
  const d = cuerpo.data;
  assert.deepEqual([d.periodo, d.desde, d.hasta], ["2000-04", "2000-04-01", "2000-04-30"]);
  assert.deepEqual([d.ordenes_pagadas_total, d.valor, d.color, d.sin_ordenes_pagadas], [3, 6, "VERDE", false]); // (4 + 6 + 8) / 3
  assert.equal((await pedir("?periodo=2000-06")).cuerpo.data.valor, 12);
  assert.equal((await pedir("?periodo=2000-06")).cuerpo.data.color, "AMARILLO");
  const julio = (await pedir("?periodo=2000-07")).cuerpo.data;
  assert.deepEqual([julio.valor, julio.color], [50, "ROJO"]); // creada 01/06, pagada 21/07
});

test("solo cuentan las ordenes pagadas dentro del mes en hora de Bolivia (la pagada 00:10 del 1/5 es de mayo)", async () => {
  const d = (await pedir()).cuerpo.data;
  assert.equal(d.ordenes_pagadas_total, 3);
  assert.equal((await pedir("?periodo=2000-05")).cuerpo.data.ordenes_pagadas_total, 1);
  assert.equal((await pedir("?periodo=2000-03")).cuerpo.data.ordenes_pagadas_total, 1);
});

test("las ordenes pagadas: orden, proveedor, dias, monto y estado PAGADA, la mas reciente primero", async () => {
  const d = (await pedir()).cuerpo.data;
  assert.equal(d.ordenes_pagadas.length, 3);
  // por fecha de pago, la mas reciente primero: la pagada el 08/04 (6 dias), la del 05/04 (4) y la del 02/04 (8)
  assert.deepEqual(d.ordenes_pagadas.map((o) => [o.dias, o.estado]), [[6, "PAGADA"], [4, "PAGADA"], [8, "PAGADA"]]);
  const sur = d.ordenes_pagadas.find((o) => o.proveedor === "Insumos del Sur");
  assert.deepEqual([sur.dias, sur.monto, sur.estado], [4, 500, "PAGADA"]);
  assert.equal((await pedir("?periodo=2000-04&limite=1")).cuerpo.data.ordenes_pagadas.length, 1);
  for (const malo of ["0", "101", "x"]) assert.equal((await pedir(`?periodo=2000-04&limite=${malo}`)).status, 400, malo);
});

test("las vencidas: aprobadas hasta fin de mes, aun sin pagar y con MAS de 15 dias (la mas atrasada primero)", async () => {
  const d = await diasPagoProveedores({ periodo: "2000-04", ahora: AHORA });
  assert.equal(d.ordenes_vencidas_total, 2); // la del 05/04 (24,9 dias) y la del 01/03 (59,9); la del 28/04 lleva 1 dia y la de mayo no es de abril
  assert.deepEqual(d.ordenes_vencidas.map((o) => [o.proveedor, o.monto, o.estado, Math.floor(o.dias)]), [
    ["Proveedor T181", 77, "VENCIDA", 59], // 01/03 10:00 a 30/04 08:00 = 59,9 dias
    ["Distribuidora Andina", 3450, "VENCIDA", 24],
  ]);
});

test("el limite de las vencidas: 15 dias justos no vencen; mas de 15 si", async () => {
  const quince = await diasPagoProveedores({ periodo: "2000-04", ahora: new Date("2000-04-20T14:00:00Z") }); // la del 05/04 10:00-04 (14:00Z) lleva 15,0 dias
  assert.ok(!quince.ordenes_vencidas.some((o) => o.monto === 3450));
  const pasados = await diasPagoProveedores({ periodo: "2000-04", ahora: new Date("2000-04-20T14:10:00Z") });
  assert.ok(pasados.ordenes_vencidas.some((o) => o.monto === 3450));
});

test("las ordenes RECIBIDAS de Compras en el mes y cuando llego la ultima (para la tarjeta Compras del Monitor)", async () => {
  // llegadas en abril de 2000: las del 01/04, 02/04, 05/04, 10/04 y 28/04 (las del 25/03, 01/03 y 10/05 no)
  const d = (await pedir()).cuerpo.data;
  assert.equal(d.ordenes_recibidas, 5);
  assert.equal(new Date(d.ultima_orden_recibida_en).toISOString(), "2000-04-28T14:00:00.000Z"); // 28/04 10:00 Bolivia
  const sin = (await pedir("?periodo=2000-09")).cuerpo.data;
  assert.deepEqual([sin.ordenes_recibidas, sin.ultima_orden_recibida_en], [0, null]);
});

test("un mes sin ordenes pagadas: promedio y color null (sin_ordenes_pagadas), listas vacias", async () => {
  const d = (await pedir("?periodo=2000-09")).cuerpo.data;
  assert.deepEqual([d.valor, d.color, d.sin_ordenes_pagadas, d.ordenes_pagadas, d.ordenes_pagadas_total], [null, null, true, [], 0]);
});

test("solo el administrador: sin token 401, cajero 403; periodo invalido 400; sin periodo usa el mes actual", async () => {
  assert.equal((await pedir("?periodo=2000-04", null)).status, 401);
  assert.equal((await pedir("?periodo=2000-04", "CAJERO")).status, 403);
  assert.equal((await pedir("?periodo=2000-13")).status, 400);
  const actual = await pedir("");
  assert.equal(actual.status, 200);
  assert.match(actual.cuerpo.data.periodo, /^\d{4}-\d{2}$/);
});
