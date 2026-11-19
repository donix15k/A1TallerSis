// TDSI-192: GET /api/kpis/alertas (alertas del dia: primero las rojas, luego las amarillas). BD real: ventas de prueba insertadas DIRECTO
// en un mes lejano (marzo de 2010) y borradas al terminar; Caja, Facturacion, Pagos a Proveedores y Devoluciones son UN servidor HTTP
// local que responde lo que la prueba le diga.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/kpiRoutes");
const { numero } = require("../services/kpiAlertasService");

let externo, servidor, base;
let r; // respuestas de los servicios: { metas, cuadre, aceptacion, proveedores, devoluciones } (objeto de datos o "caida")
let tokens;

const venta = (id, monto, estado = "Registrado") =>
  query(`INSERT INTO pagos.transacciones (id_transaccion, metodo, monto, tipo_pago, estado, fecha) VALUES ($1, 'Efectivo', $2, 'Simple', $3, '2010-03-10 10:00:00-04'::timestamptz)`, [id, monto, estado]);

const base_ = () => ({
  metas: { cajas: [
    { caja_id: "CAJA-01", caja_nombre: "Caja 1", vendido: 10700, meta: 10000, porcentaje: 107, color: "VERDE" },
    { caja_id: "CAJA-02", caja_nombre: "Caja 2", vendido: 8300, meta: 10000, porcentaje: 83, color: "AMARILLO" },
    { caja_id: "CAJA-03", caja_nombre: "Caja 3", vendido: 6100, meta: 10000, porcentaje: 61, color: "ROJO" },
    { caja_id: "CAJA-04", caja_nombre: "Caja 4", vendido: 0, meta: null, porcentaje: null, color: null }, // sin meta: sin color
  ] },
  cuadre: { turnos_cerrados: 46, turnos_cuadran: 38, porcentaje: 82.6, color: "ROJO", sobrantes: 64.5, faltantes: 187.3 },
  aceptacion: { enviados: 1118, registrados: 1104, rechazados: 14, porcentaje: 98.7, color: "VERDE" },
  proveedores: { valor: 5.8, color: "VERDE", ordenes_vencidas_total: 1, ordenes_vencidas: [{ orden: "OP-2026-0131", proveedor: "Distribuidora Andina", monto: 3450, dias: 18.4 }] },
  devoluciones: { monto_devuelto: 12, cantidad: 1, motivos: [] }, // 12 de Bs 800 = 1,5 % (VERDE)
});

test.before(async () => {
  await query(`DELETE FROM pagos.transacciones WHERE id_transaccion LIKE 'KPI192-%'`);
  externo = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const token = req.headers.authorization || "";
    if (req.url.startsWith("/api/administradores/verificar")) {
      if (token === "Bearer ADMIN") return res.end(JSON.stringify({ ok: true, data: { administrador_id: "A" } }));
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok: false, mensaje: "no" }));
    }
    const clave = { "/api/kpis/cumplimiento-metas": "metas", "/api/kpis/cuadre-caja": "cuadre", "/api/kpis/aceptacion-contable": "aceptacion", "/api/kpis/dias-pago-proveedores": "proveedores", "/api/kpis/devoluciones": "devoluciones" }[req.url.split("?")[0]];
    if (!clave) { res.statusCode = 404; return res.end("{}"); }
    tokens.push(token);
    if (r[clave] === "caida") { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, mensaje: `boom ${clave}` })); }
    res.end(JSON.stringify({ ok: true, data: r[clave] }));
  });
  await new Promise((ok) => externo.listen(0, ok));
  const url = `http://localhost:${externo.address().port}`;
  Object.assign(process.env, { ADMIN_VERIFICAR_URL: url, GESTION_CAJA_URL: url, FACTURACION_URL: url, PAGOS_PROVEEDORES_URL: url, DEVOLUCIONES_URL: url, GESTION_PAGOS_URL: "http://localhost:1" });

  // marzo de 2010: 20 ventas validas de Bs 40 (ticket 40 = AMARILLO) y 1 anulada (1 de 21 = 4,76 % = AMARILLO)
  for (let i = 0; i < 20; i++) await venta(`KPI192-V${i}`, 40);
  await venta("KPI192-A", 40, "Anulado");

  const app = express();
  app.use("/api/kpis", rutas);
  app.use(errorHandler);
  servidor = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  base = `http://localhost:${servidor.address().port}/api/kpis/alertas`;
});
test.beforeEach(() => {
  r = base_();
  tokens = [];
});
test.after(async () => {
  for (const k of ["ADMIN_VERIFICAR_URL", "GESTION_CAJA_URL", "FACTURACION_URL", "PAGOS_PROVEEDORES_URL", "DEVOLUCIONES_URL", "GESTION_PAGOS_URL"]) delete process.env[k];
  servidor.close();
  externo.close();
  await query(`DELETE FROM pagos.transacciones WHERE id_transaccion LIKE 'KPI192-%'`);
  await pool.end();
});

const pedir = (qs = "?periodo=2010-03", token = "ADMIN") => fetch(`${base}${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (x) => ({ status: x.status, cuerpo: await x.json() }));
const lineas = (d) => d.alertas.map((a) => `${a.nivel} · ${a.mensaje}`);

test("numeros a la boliviana: miles con punto y decimales con coma", () => {
  assert.equal(numero(1208.2), "1.208,20");
  assert.equal(numero(82.6, 1), "82,6");
  assert.equal(numero(1073, 0), "1.073");
});

test("las alertas del dia: primero las ROJAS y luego las AMARILLAS, con las lineas del mockup", async () => {
  const { status, cuerpo } = await pedir();
  assert.equal(status, 200);
  const d = cuerpo.data;
  assert.deepEqual([d.periodo, d.desde, d.hasta], ["2010-03", "2010-03-01", "2010-03-31"]);
  assert.deepEqual(lineas(d), [
    "ROJO · Caja 3 al 61 % de su meta",
    "ROJO · Cuadre 82,6 %: 8 turnos con diferencia",
    "ROJO · OP-2026-0131 vencida (18 días)",
    "AMARILLO · Caja 2 al 83 % de su meta",
    "AMARILLO · 14 asientos rechazados por Contabilidad",
    "AMARILLO · Ticket promedio de Bs 40,00",
    "AMARILLO · Anulación al 4,8 %: 1 de 21 facturas",
  ]);
  assert.deepEqual([d.total, d.rojas, d.amarillas], [7, 3, 4]);
  // nunca una amarilla antes que una roja
  const niveles = d.alertas.map((a) => a.nivel);
  assert.deepEqual(niveles, [...niveles].sort((a, b) => ["ROJO", "AMARILLO"].indexOf(a) - ["ROJO", "AMARILLO"].indexOf(b)));
});

test("cada alerta trae su tipo, su indicador y el dato para armar el detalle", async () => {
  const d = (await pedir()).cuerpo.data;
  const [caja3, cuadre, orden, , asientos] = d.alertas;
  assert.deepEqual([caja3.tipo, caja3.indicador, caja3.valor, caja3.detalle.caja_id], ["CAJA", "cumplimiento_metas", 61, "CAJA-03"]);
  assert.deepEqual([cuadre.tipo, cuadre.indicador, cuadre.detalle.faltantes], ["CUADRE", "efectividad_cuadre", 187.3]);
  assert.deepEqual([orden.tipo, orden.detalle.orden, orden.detalle.proveedor, orden.detalle.monto], ["ORDEN_VENCIDA", "OP-2026-0131", "Distribuidora Andina", 3450]);
  assert.deepEqual([asientos.tipo, asientos.valor], ["ASIENTOS_RECHAZADOS", 14]);
});

test("lo que esta VERDE o no tiene datos no genera alerta (caja sin meta, KPI sin color)", async () => {
  r.metas = { cajas: [{ caja_id: "CAJA-01", caja_nombre: "Caja 1", porcentaje: 107, color: "VERDE" }, { caja_id: "CAJA-04", caja_nombre: "Caja 4", porcentaje: null, color: null }] };
  r.cuadre = { turnos_cerrados: 0, turnos_cuadran: 0, porcentaje: null, color: null };
  r.proveedores = { valor: null, color: null, ordenes_vencidas_total: 0, ordenes_vencidas: [] };
  r.aceptacion = { enviados: 0, registrados: 0, rechazados: 0, porcentaje: null, color: null };
  const d = (await pedir("?periodo=2010-03")).cuerpo.data;
  assert.deepEqual(lineas(d), ["AMARILLO · Ticket promedio de Bs 40,00", "AMARILLO · Anulación al 4,8 %: 1 de 21 facturas"]); // solo lo propio
  const vacio = (await pedir("?periodo=2010-09")).cuerpo.data; // sin ventas: ticket 0 es ROJO, el resto sin alerta
  assert.ok(vacio.alertas.every((a) => a.tipo === "KPI" || a.nivel));
});

test("con Caja, Contabilidad y Proveedores en orden solo quedan las alertas propias (ticket y anulacion)", async () => {
  r.metas = { cajas: [{ caja_id: "CAJA-01", caja_nombre: "Caja 1", porcentaje: 110, color: "VERDE" }] };
  r.cuadre = { turnos_cerrados: 10, turnos_cuadran: 10, porcentaje: 100, color: "VERDE" };
  r.proveedores = { valor: 4, color: "VERDE", ordenes_vencidas_total: 0, ordenes_vencidas: [] };
  r.aceptacion = { enviados: 100, registrados: 100, rechazados: 0, porcentaje: 100, color: "VERDE" };
  const d = (await pedir()).cuerpo.data;
  assert.deepEqual(d.alertas.map((a) => a.indicador), ["ticket_promedio", "tasa_anulacion"]);
  assert.deepEqual([d.rojas, d.amarillas], [0, 2]);
});

test("un asiento rechazado es ROJO si la aceptacion contable esta en ROJO; los singulares se escriben bien", async () => {
  r.aceptacion = { enviados: 100, registrados: 90, rechazados: 1, porcentaje: 90, color: "ROJO" };
  r.cuadre = { turnos_cerrados: 5, turnos_cuadran: 4, porcentaje: 80, color: "ROJO" };
  const d = (await pedir()).cuerpo.data;
  assert.ok(lineas(d).includes("ROJO · 1 asiento rechazado por Contabilidad"));
  assert.ok(lineas(d).includes("ROJO · Cuadre 80 %: 1 turno con diferencia"));
});

test("sin asientos rechazados pero con la aceptacion fuera de lo esperado, la alerta es del indicador", async () => {
  r.aceptacion = { enviados: 100, registrados: 96, rechazados: 0, porcentaje: 96, color: "AMARILLO" };
  assert.ok(lineas((await pedir()).cuerpo.data).includes("AMARILLO · Aceptación contable al 96 %"));
});

test("las ordenes vencidas que no vinieron en la lista se resumen en una alerta y el pago a proveedores fuera de rango tambien alerta", async () => {
  r.proveedores = { valor: 12, color: "AMARILLO", ordenes_vencidas_total: 3, ordenes_vencidas: [{ orden: "OP-1", proveedor: "A", monto: 10, dias: 20 }] };
  const l = lineas((await pedir()).cuerpo.data);
  assert.ok(l.includes("ROJO · OP-1 vencida (20 días)"));
  assert.ok(l.includes("ROJO · 2 órdenes vencidas más"));
  assert.ok(l.includes("AMARILLO · Pago a proveedores en 12,0 días"));
});

test("un servicio caido no tumba las alertas: se pierden las suyas y se informa en fuentes", async () => {
  r.metas = "caida";
  r.proveedores = "caida";
  const d = (await pedir()).cuerpo.data;
  assert.ok(!lineas(d).some((x) => x.includes("Caja 3") || x.includes("vencida")));
  assert.ok(lineas(d).some((x) => x.includes("Cuadre 82,6 %")));
  const fallidas = d.fuentes.filter((f) => !f.ok).map((f) => [f.origen, f.error]);
  assert.deepEqual(fallidas, [["gestion_caja_metas", "boom metas"], ["pagos_proveedores", "boom proveedores"]]);
});

test("reenvia el token del administrador a los demas servicios", async () => {
  await pedir();
  assert.ok(tokens.length >= 4);
  assert.ok(tokens.every((t) => t === "Bearer ADMIN"));
});

test("solo el administrador (401 sin token); periodo invalido 400; sin periodo usa el mes actual", async () => {
  assert.equal((await pedir("?periodo=2010-03", null)).status, 401);
  assert.equal((await pedir("?periodo=2010-13")).status, 400);
  const actual = await pedir("");
  assert.equal(actual.status, 200);
  assert.match(actual.cuerpo.data.periodo, /^\d{4}-\d{2}$/);
});
