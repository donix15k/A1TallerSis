// TDSI-190/191: pagos.kpi_objetivos (los rangos del semaforo de los 7 KPIs) y la funcion que calcula el color de un valor. BD real; el
// unico cambio que hacen las pruebas (un limite de "dias_pago_proveedores") se restaura al terminar. El administrador se valida contra
// un Gestion de Caja local.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/kpiRoutes");
const { colorSegun, listarObjetivos, limitesDe, colorDe, limitesPorDefecto, INDICADORES } = require("../services/kpiObjetivosService");
const { colorTicketPromedio, colorTasaAnulacion, colorTasaDevoluciones } = require("../services/kpiService");

let caja, servidor, base;
let original; // la fila de dias_pago_proveedores antes de la prueba

test.before(async () => {
  original = (await query(`SELECT limite_verde, limite_amarillo, limite_rojo FROM pagos.kpi_objetivos WHERE indicador = 'dias_pago_proveedores'`)).rows[0];
  caja = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if ((req.headers.authorization || "") === "Bearer ADMIN") return res.end(JSON.stringify({ ok: true, data: { administrador_id: "A" } }));
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, mensaje: "no" }));
  });
  await new Promise((r) => caja.listen(0, r));
  process.env.ADMIN_VERIFICAR_URL = `http://localhost:${caja.address().port}`;
  const app = express();
  app.use("/api/kpis", rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis/objetivos`;
});
test.after(async () => {
  if (original) await restaurar();
  delete process.env.ADMIN_VERIFICAR_URL;
  servidor.close();
  caja.close();
  await pool.end();
});

const restaurar = () =>
  query(`UPDATE pagos.kpi_objetivos SET limite_verde = $1, limite_amarillo = $2, limite_rojo = $3 WHERE indicador = 'dias_pago_proveedores'`, [original.limite_verde, original.limite_amarillo, original.limite_rojo]);

test("la tabla trae los 7 indicadores con los rangos iniciales del PDF y su sentido", async () => {
  const lista = await listarObjetivos();
  assert.deepEqual(lista.map((o) => o.indicador), INDICADORES.map((i) => i.indicador));
  assert.equal(lista.length, 7);
  const por = Object.fromEntries(lista.map((o) => [o.indicador, [o.verde, o.amarillo, o.rojo, o.sentido]]));
  assert.deepEqual(por, {
    ticket_promedio: [45, 35, 0, "MAYOR"],
    tasa_anulacion: [2, 5, 10, "MENOR"],
    tasa_devoluciones: [1.5, 3, 6, "MENOR"],
    cumplimiento_metas: [100, 70, 0, "MAYOR"],
    efectividad_cuadre: [95, 85, 0, "MAYOR"],
    aceptacion_contable: [98, 95, 0, "MAYOR"],
    dias_pago_proveedores: [7, 15, 30, "MENOR"],
  });
});

test("el color de cada KPI en sus limites: el extremo del verde es VERDE, el del amarillo es AMARILLO y despues, ROJO", () => {
  const casos = {
    ticket_promedio: [[45, "VERDE"], [44.99, "AMARILLO"], [35, "AMARILLO"], [34.99, "ROJO"]],
    tasa_anulacion: [[2, "VERDE"], [2.01, "AMARILLO"], [5, "AMARILLO"], [5.01, "ROJO"]],
    tasa_devoluciones: [[1.5, "VERDE"], [1.51, "AMARILLO"], [3, "AMARILLO"], [3.01, "ROJO"]],
    cumplimiento_metas: [[100, "VERDE"], [99.99, "AMARILLO"], [70, "AMARILLO"], [69.99, "ROJO"]],
    efectividad_cuadre: [[95, "VERDE"], [94.99, "AMARILLO"], [85, "AMARILLO"], [84.99, "ROJO"]],
    aceptacion_contable: [[98, "VERDE"], [97.99, "AMARILLO"], [95, "AMARILLO"], [94.99, "ROJO"]],
    dias_pago_proveedores: [[7, "VERDE"], [7.1, "AMARILLO"], [15, "AMARILLO"], [15.1, "ROJO"]],
  };
  for (const [indicador, lista] of Object.entries(casos)) {
    for (const [valor, color] of lista) assert.equal(colorSegun(valor, limitesPorDefecto(indicador)), color, `${indicador} ${valor}`);
  }
});

test("un indicador sin datos (null, vacio, NaN) no tiene color", () => {
  const l = limitesPorDefecto("tasa_anulacion");
  for (const sinDatos of [null, undefined, "", NaN, "abc"]) assert.equal(colorSegun(sinDatos, l), null, String(sinDatos));
  assert.equal(colorSegun(0, l), "VERDE"); // 0 % de anulacion SI es un dato
});

test("las funciones de color de los KPIs usan la misma regla y aceptan otros limites", () => {
  assert.equal(colorTicketPromedio(40), "AMARILLO");
  assert.equal(colorTasaAnulacion(6), "ROJO");
  assert.equal(colorTasaDevoluciones(1.5), "VERDE");
  assert.equal(colorTicketPromedio(40, { verde: 40, amarillo: 30, rojo: 0, sentido: "MAYOR" }), "VERDE"); // con otros objetivos cambia el color
});

test("cambiar un objetivo cambia el color desde ese momento (sin reiniciar nada)", async () => {
  assert.equal(await colorDe("dias_pago_proveedores", 9), "AMARILLO");
  await query(`UPDATE pagos.kpi_objetivos SET limite_verde = 10 WHERE indicador = 'dias_pago_proveedores'`);
  assert.equal(await colorDe("dias_pago_proveedores", 9), "VERDE");
  assert.equal((await limitesDe("dias_pago_proveedores")).verde, 10);
  await restaurar();
  assert.equal(await colorDe("dias_pago_proveedores", 9), "AMARILLO");
});

test("la base rechaza limites incoherentes (el amarillo siempre entre el verde y el rojo)", async () => {
  await assert.rejects(query(`UPDATE pagos.kpi_objetivos SET limite_amarillo = 50 WHERE indicador = 'ticket_promedio'`), (e) => e.code === "23514"); // MAYOR: amarillo > verde
  await assert.rejects(query(`UPDATE pagos.kpi_objetivos SET limite_amarillo = 1 WHERE indicador = 'tasa_anulacion'`), (e) => e.code === "23514"); // MENOR: amarillo < verde
  assert.equal((await limitesDe("ticket_promedio")).amarillo, 35); // no cambio nada
});

test("un indicador que no existe no tiene limites", async () => {
  assert.equal(await limitesDe("inventado"), null);
  assert.equal(limitesPorDefecto("inventado"), null);
});

test("GET /api/kpis/objetivos: solo el administrador, con los 7 indicadores", async () => {
  assert.equal((await fetch(base)).status, 401);
  const r = await fetch(base, { headers: { Authorization: "Bearer ADMIN" } });
  assert.equal(r.status, 200);
  const { data } = await r.json();
  assert.equal(data.indicadores.length, 7);
  assert.deepEqual(data.indicadores.find((i) => i.indicador === "efectividad_cuadre"), { indicador: "efectividad_cuadre", nombre: "Efectividad de cuadre", unidad: "%", verde: 95, amarillo: 85, rojo: 0, sentido: "MAYOR", actualizado_por: null, actualizado_en: data.indicadores.find((i) => i.indicador === "efectividad_cuadre").actualizado_en });
});

test("GET /api/kpis/semaforo (TDSI-219): los rangos se pueden LEER sin ser administrador (lo usa la pantalla del cajero), solo lo necesario", async () => {
  const r = await fetch(base.replace("/objetivos", "/semaforo")); // sin token
  assert.equal(r.status, 200);
  const { data } = await r.json();
  assert.equal(data.indicadores.length, 7);
  assert.deepEqual(Object.keys(data.indicadores[0]).sort(), ["amarillo", "indicador", "nombre", "rojo", "sentido", "unidad", "verde"]); // sin quien los cambio
  assert.deepEqual(data.indicadores.find((i) => i.indicador === "cumplimiento_metas"), { indicador: "cumplimiento_metas", nombre: "Cumplimiento de metas", unidad: "%", verde: 100, amarillo: 70, rojo: 0, sentido: "MAYOR" });
  // cambiar los objetivos sigue siendo solo del administrador
  assert.equal((await fetch(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ indicadores: [] }) })).status, 401);
});
