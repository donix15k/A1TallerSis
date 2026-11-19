// TDSI-24: GET /api/devoluciones/:codigo (base real).
const test = require("node:test");
const assert = require("node:assert/strict");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
const CAJERO = "cajero.consulta@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[1]; // "Producto equivocado"
});

test.after(() => entorno.cerrar());

async function registrarEjemplo(n) {
  const numero = entorno.agregarFactura(n);
  const { cuerpo } = await entorno.post("/api/devoluciones", {
    factura_numero: numero,
    items: [{ descripcion: "Producto A", cantidad: 2 }, { descripcion: "Producto B", cantidad: 1 }],
    motivo_id: motivoId.id,
    observaciones: "Me dieron otro color",
    cajero: CAJERO,
  });
  return { numero, codigo: cuerpo.data.codigo };
}

test("devuelve estado, items, motivo y monto de la devolucion", async () => {
  const { numero, codigo } = await registrarEjemplo(1);
  const { status, cuerpo } = await entorno.get(`/api/devoluciones/${codigo}`);
  assert.equal(status, 200);
  const d = cuerpo.data;
  assert.equal(d.codigo, codigo);
  assert.equal(d.estado, "PENDIENTE");
  assert.equal(d.tipo, "PARCIAL");
  assert.equal(d.monto_total, 45);
  assert.equal(d.factura_numero, numero);
  assert.equal(d.cliente_nit, "1234567");
  assert.deepEqual(d.motivo, { id: motivoId.id, nombre: "Producto equivocado" });
  assert.equal(d.observaciones, "Me dieron otro color");
  assert.equal(d.cajero, CAJERO);
  assert.equal(d.requiere_autorizacion, false);
  assert.equal(d.motivo_rechazo, null);
  assert.equal(d.autorizado_por, null);
  assert.deepEqual(d.items, [
    { descripcion: "Producto A", cantidad: 2, precio_unitario: 10, subtotal: 20 },
    { descripcion: "Producto B", cantidad: 1, precio_unitario: 25, subtotal: 25 },
  ]);
});

test("incluye el historial de estados desde el registro", async () => {
  const { codigo } = await registrarEjemplo(2);
  const { cuerpo } = await entorno.get(`/api/devoluciones/${codigo}`);
  assert.equal(cuerpo.data.historial.length, 1);
  assert.equal(cuerpo.data.historial[0].estado_anterior, null);
  assert.equal(cuerpo.data.historial[0].estado_nuevo, "PENDIENTE");
  assert.equal(cuerpo.data.historial[0].cambiado_por, CAJERO);
});

test("acepta el codigo en minusculas y con espacios", async () => {
  const { codigo } = await registrarEjemplo(3);
  const { status, cuerpo } = await entorno.get(`/api/devoluciones/${encodeURIComponent(`  ${codigo.toLowerCase()} `)}`);
  assert.equal(status, 200);
  assert.equal(cuerpo.data.codigo, codigo);
});

test("codigo inexistente: 404; codigo con forma invalida: 400", async () => {
  const noExiste = await entorno.get("/api/devoluciones/DEV-999999");
  assert.equal(noExiste.status, 404);
  assert.match(noExiste.cuerpo.mensaje, /No se encontró la devolución DEV-999999/);
  for (const malo of ["abc", "DEV-", "DEV-12a", "F-000012", "DEV-12345678901"]) {
    const r = await entorno.get(`/api/devoluciones/${malo}`);
    assert.equal(r.status, 400, `deberia rechazar ${malo}`);
  }
});

test("las rutas fijas (motivos y factura/:numero) no se confunden con un codigo", async () => {
  assert.equal((await entorno.get("/api/devoluciones/motivos")).status, 200);
  assert.equal((await entorno.get(`/api/devoluciones/factura/${entorno.agregarFactura(4)}`)).status, 200);
});
