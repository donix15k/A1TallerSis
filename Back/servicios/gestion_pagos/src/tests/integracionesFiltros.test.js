// TDSI-127: filtros (grupo C/D/E, estado, rango de fechas) y paginacion de GET /api/integraciones/mensajes. Fuentes FALSAS con
// datos fijos (sin red ni base); el administrador se valida contra un Gestion de Caja local.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { errorHandler } = require("../middlewares/errorHandler");
const rutas = require("../routes/integracionesRoutes");
const { usarFuentesDePrueba, mensaje } = require("../services/integraciones/fuentes");
const { validarFiltros } = require("../services/integracionesService");

let caja, servidor, base;
let cantidad = 45;

const fuenteFalsa = (origen, grupo, estados, base0) => ({
  origen,
  listar: async () => estados.map((estado, i) => mensaje({ origen, id: i, grupo, tipo: `T-${origen}`, referencia: `${origen}-${i}`, fecha: new Date(Date.parse(base0) + i * 3600_000).toISOString(), estado })),
  reenviar: async () => {},
});

test.before(async () => {
  caja = http.createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: true, data: { administrador_id: "A", nombre: "Admin" } })); });
  await new Promise((r) => caja.listen(0, r));
  process.env.ADMIN_VERIFICAR_URL = `http://localhost:${caja.address().port}`;
  const app = express();
  app.use("/api/integraciones", rutas);
  app.use(errorHandler);
  servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://localhost:${servidor.address().port}/api/integraciones/mensajes`;
});
test.beforeEach(() => {
  usarFuentesDePrueba([
    // Contabilidad (D): 2026-03-10 00:00 en Bolivia = 04:00Z
    fuenteFalsa("a", "D", ["Enviado", "Respondido", "Error", "Pendiente"], "2026-03-10T04:00:00.000Z"),
    // Compras (C)
    fuenteFalsa("b", "C", ["Enviado", "Error"], "2026-03-12T10:00:00.000Z"),
    // Marketplace (E): muchos, para paginar
    fuenteFalsa("c", "E", Array.from({ length: cantidad }, (_, i) => (i % 5 === 0 ? "Error" : "Enviado")), "2026-04-01T00:00:00.000Z"),
  ]);
});
test.after(async () => {
  usarFuentesDePrueba(null);
  delete process.env.ADMIN_VERIFICAR_URL;
  servidor.close();
  caja.close();
});

const pedir = (qs = "") => fetch(`${base}?${qs}`, { headers: { Authorization: "Bearer X" } }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));

test("sin filtros: de 20 en 20 con total, pagina y total_paginas", async () => {
  const { cuerpo } = await pedir();
  assert.deepEqual([cuerpo.total, cuerpo.pagina, cuerpo.por_pagina, cuerpo.total_paginas, cuerpo.data.length], [51, 1, 20, 3, 20]);
  const p3 = (await pedir("pagina=3")).cuerpo;
  assert.deepEqual([p3.pagina, p3.data.length], [3, 11]);
  assert.equal((await pedir("pagina=4")).cuerpo.data.length, 0);
});

test("filtra por grupo (C, D o E, sin distinguir mayusculas)", async () => {
  assert.deepEqual((await pedir("grupo=d")).cuerpo.data.map((m) => m.origen), ["a", "a", "a", "a"].reverse().map(() => "a"));
  assert.equal((await pedir("grupo=C")).cuerpo.total, 2);
  const e = (await pedir("grupo=E&por_pagina=100")).cuerpo;
  assert.deepEqual([e.total, e.data.length, e.data.every((m) => m.grupo === "E")], [45, 45, true]);
});

test("filtra por estado y se combina con grupo", async () => {
  assert.deepEqual((await pedir("estado=error")).cuerpo.total, 1 + 1 + 9); // a:1, b:1, c: 9 (cada 5to de 45)
  assert.deepEqual((await pedir("grupo=D&estado=Respondido")).cuerpo.data.map((m) => m.referencia), ["a-1"]);
  assert.equal((await pedir("grupo=C&estado=Pendiente")).cuerpo.total, 0);
});

test("rango de fechas inclusivo en hora de Bolivia: 'hasta' incluye el dia completo", async () => {
  // a-0 10/03 00:00, a-1 01:00, a-2 02:00, a-3 03:00 (Bolivia); b-0 12/03 06:00, b-1 07:00 ; c desde 31/03 20:00 (Bolivia)
  assert.equal((await pedir("desde=2026-03-10&hasta=2026-03-10")).cuerpo.total, 4);
  assert.equal((await pedir("desde=2026-03-11&hasta=2026-03-31&grupo=C")).cuerpo.total, 2);
  assert.equal((await pedir("hasta=2026-03-11")).cuerpo.total, 4);
  assert.equal((await pedir("desde=2026-03-13&hasta=2026-03-30")).cuerpo.total, 0);
  const abril = (await pedir("desde=2026-04-01&grupo=E&por_pagina=100")).cuerpo;
  assert.ok(abril.total > 0 && abril.total <= 45);
});

test("por_pagina cambia el tamano (maximo 100) y las paginas no repiten ni pierden mensajes", async () => {
  const todos = [];
  for (let p = 1; p <= 6; p++) todos.push(...(await pedir(`por_pagina=10&pagina=${p}`)).cuerpo.data.map((m) => `${m.origen}:${m.id}`));
  assert.equal(todos.length, 51);
  assert.equal(new Set(todos).size, 51);
  assert.equal((await pedir("por_pagina=100")).cuerpo.data.length, 51);
});

test("filtros invalidos dan 400: grupo, estado, fechas, desde > hasta, pagina y por_pagina", async () => {
  for (const qs of ["grupo=F", "grupo=CD", "estado=otro", "desde=2026-13-01", "hasta=2026-02-30", "desde=10/03/2026", "desde=2026-03-12&hasta=2026-03-10", "pagina=0", "pagina=abc", "por_pagina=0", "por_pagina=101", "por_pagina=1.5"]) {
    assert.equal((await pedir(qs)).status, 400, qs);
  }
  assert.deepEqual(validarFiltros({ grupo: " e ", estado: "ERROR" }), { grupo: "E", estado: "Error", desde: null, hasta: null, pagina: 1, por_pagina: 20 });
});
