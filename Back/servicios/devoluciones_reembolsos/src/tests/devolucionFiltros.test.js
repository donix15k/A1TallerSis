// TDSI-79: GET /api/devoluciones con filtros desde/hasta (dia completo, hora de Bolivia), estado y cajero, y paginacion
// de 20 en 20. BD real (se aisla con un cajero propio); limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let molde; // codigo de una devolucion real que sirve de molde para las filas masivas
const SUF = String(Date.now()).slice(-7);
const CAJERO = `filtros.${SUF}@tallersis.test`;
const OTRO = `Otro.Filtros.${SUF}@tallersis.test`;
const codigos = {};

async function registrar(n, { cajero = CAJERO } = {}) {
  const numero = entorno.agregarFactura(n);
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1 }], motivo_id: motivoId, cajero });
  return cuerpo.data.codigo;
}
const fijar = (codigo, ts, estado) => query(`UPDATE devoluciones.devoluciones SET fecha_solicitud = $2::timestamptz, estado = COALESCE($3, estado) WHERE codigo = $1`, [codigo, ts, estado ?? null]);
const listar = (qs) => entorno.get(`/api/devoluciones?${qs}`);
const mios = (r) => r.cuerpo.data.filter((f) => [CAJERO, OTRO].includes(f.cajero)).map((f) => f.codigo);

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  // horas en Bolivia (UTC-4): 10/03 00:00, 10/03 23:59:59, 11/03 00:00, 12/03 12:00
  codigos.inicio10 = await registrar(1);
  codigos.fin10 = await registrar(2);
  codigos.inicio11 = await registrar(3, { cajero: OTRO });
  codigos.medio12 = await registrar(4);
  molde = codigos.inicio10;
  await fijar(codigos.inicio10, "2026-03-10 00:00:00-04", "PENDIENTE");
  await fijar(codigos.fin10, "2026-03-10 23:59:59-04", "APROBADA");
  await fijar(codigos.inicio11, "2026-03-11 00:00:00-04", "RECHAZADA");
  await fijar(codigos.medio12, "2026-03-12 12:00:00-04", "PROCESADA");
});
test.after(() => entorno.cerrar());

test("hasta incluye el dia COMPLETO (hora de Bolivia): las 23:59:59 entran y las 00:00 del dia siguiente no", async () => {
  const r = await listar(`cajero=${SUF}&desde=2026-03-10&hasta=2026-03-10`);
  assert.equal(r.status, 200);
  assert.deepEqual(mios(r).sort(), [codigos.inicio10, codigos.fin10].sort());
});

test("desde incluye el dia completo desde las 00:00 de Bolivia", async () => {
  const r = await listar(`cajero=${SUF}&desde=2026-03-11`);
  assert.deepEqual(mios(r).sort(), [codigos.inicio11, codigos.medio12].sort());
});

test("rango de varios dias y solo hasta", async () => {
  assert.deepEqual(mios(await listar(`cajero=${SUF}&desde=2026-03-10&hasta=2026-03-11`)).sort(), [codigos.inicio10, codigos.fin10, codigos.inicio11].sort());
  assert.deepEqual(mios(await listar(`cajero=${SUF}&hasta=2026-03-10`)).sort(), [codigos.inicio10, codigos.fin10].sort());
});

test("estado (sin distinguir mayusculas) y combinado con fechas", async () => {
  assert.deepEqual(mios(await listar(`cajero=${SUF}&estado=rechazada`)), [codigos.inicio11]);
  assert.deepEqual(mios(await listar(`cajero=${SUF}&estado=APROBADA&desde=2026-03-10&hasta=2026-03-10`)), [codigos.fin10]);
  assert.deepEqual(mios(await listar(`cajero=${SUF}&estado=PROCESADA&hasta=2026-03-11`)), []);
});

test("cajero: coincidencia parcial sin distinguir mayusculas, y los % y _ no son comodines", async () => {
  assert.equal(mios(await listar(`cajero=${encodeURIComponent(`OTRO.filtros.${SUF}`)}`)).length, 1);
  assert.equal((await listar("cajero=%25")).cuerpo.total, 0);
  assert.equal((await listar("cajero=_")).cuerpo.total, 0);
});

test("paginacion de 20 en 20 con pagina, por_pagina y total_paginas; el total es el conteo completo", async () => {
  await query(
    `INSERT INTO devoluciones.devoluciones (codigo, factura_numero, cliente_nit, fecha_venta, fecha_solicitud, dentro_de_plazo, tipo, motivo_id, metodo_pago_original, monto_total, estado, creado_por)
     SELECT 'DEVPG' || $2 || g, d.factura_numero, d.cliente_nit, d.fecha_venta, '2026-04-01 12:00:00-04'::timestamptz + g * interval '1 minute', true, d.tipo, d.motivo_id, d.metodo_pago_original, d.monto_total, 'APROBADA', $3
       FROM devoluciones.devoluciones d, generate_series(1, 45) g WHERE d.codigo = $1`,
    [molde, SUF, `paginas.${SUF}@tallersis.test`]
  );
  const p = (n) => listar(`cajero=paginas.${SUF}&pagina=${n}`);
  const [a, b, c, d] = [await p(1), await p(2), await p(3), await p(4)];
  assert.deepEqual([a.cuerpo.total, a.cuerpo.pagina, a.cuerpo.por_pagina, a.cuerpo.total_paginas], [45, 1, 20, 3]);
  assert.deepEqual([a.cuerpo.data.length, b.cuerpo.data.length, c.cuerpo.data.length, d.cuerpo.data.length], [20, 20, 5, 0]);
  const todos = [...a.cuerpo.data, ...b.cuerpo.data, ...c.cuerpo.data].map((f) => f.codigo);
  assert.equal(new Set(todos).size, 45); // sin repetidos ni faltantes entre paginas
  const fechas = a.cuerpo.data.map((f) => f.fecha_solicitud);
  assert.deepEqual(fechas, [...fechas].sort().reverse()); // mas recientes primero
});

test("sin pagina funciona como la bandeja de siempre (sin paginacion, con limite)", async () => {
  const r = await listar(`cajero=paginas.${SUF}&limite=7`);
  assert.equal(r.cuerpo.data.length, 7);
  assert.equal(r.cuerpo.total, 45);
  assert.equal(r.cuerpo.pagina, undefined);
});

test("validaciones: fecha invalida, desde > hasta, pagina invalida, estado invalido (400)", async () => {
  for (const qs of ["desde=2026-13-01", "hasta=2026-02-30", "desde=10/03/2026", "desde=2026-03-12&hasta=2026-03-10", "pagina=0", "pagina=abc", "pagina=1.5", "estado=otra", `cajero=${"x".repeat(61)}`]) {
    assert.equal((await listar(qs)).status, 400, qs);
  }
});
