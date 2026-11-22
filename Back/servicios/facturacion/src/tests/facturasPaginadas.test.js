// Listado paginado de facturas con busqueda (solo lectura sobre la base real).
const test = require("node:test");
const assert = require("node:assert/strict");
const repo = require("../data/facturasRepo");
const { pool } = require("../config/db");

test.after(() => pool.end());

test("pagina de la mas reciente a la mas antigua y el total no cambia entre paginas", async () => {
  const p1 = await repo.listarFacturasPaginadas({ limite: 2, offset: 0 });
  const p2 = await repo.listarFacturasPaginadas({ limite: 2, offset: 2 });
  assert.ok(p1.total >= 1);
  assert.equal(p1.total, p2.total);
  assert.ok(p1.filas.length <= 2);
  const fechas = [...p1.filas, ...p2.filas].map((f) => new Date(f.fecha).getTime());
  assert.deepEqual(fechas, [...fechas].sort((a, b) => b - a));
  if (p1.filas.length && p2.filas.length) assert.notEqual(p1.filas[0].numero, p2.filas[0].numero);
});

test("busca por numero, nombre o NIT sin distinguir mayusculas, y los comodines se toman literales", async () => {
  const todas = await repo.listarFacturasPaginadas({ limite: 1 });
  const f = todas.filas[0];
  const porNumero = await repo.listarFacturasPaginadas({ q: f.numero.toLowerCase() });
  assert.ok(porNumero.filas.some((x) => x.numero === f.numero));
  if (f.cliente_nombre) {
    const porNombre = await repo.listarFacturasPaginadas({ q: f.cliente_nombre.slice(0, 4).toUpperCase() });
    assert.ok(porNombre.filas.some((x) => x.numero === f.numero));
  }
  const exacto = await repo.listarFacturasPaginadas({ numeros: [f.numero] });
  assert.deepEqual(exacto.filas.map((x) => x.numero), [f.numero]);
  assert.equal((await repo.listarFacturasPaginadas({ q: "%" })).total, 0); // "%" no es comodin
  assert.equal((await repo.listarFacturasPaginadas({ q: "zzz-no-existe-zzz" })).total, 0);
});
