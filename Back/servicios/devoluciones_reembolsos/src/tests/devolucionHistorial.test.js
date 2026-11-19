// TDSI-23: primer movimiento de historial_estados (sin estado -> PENDIENTE) y marca de autorizacion
// del supervisor cuando el monto supera 500 Bs (base real).
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
const CAJERO = "cajero.historial@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});

test.after(() => entorno.cerrar());

// Factura de un solo producto con el precio indicado, para controlar el monto exacto de la devolucion.
function facturaConPrecio(n, precio) {
  return entorno.agregarFactura(n, {
    items: [{ descripcion: "Producto caro", cantidad: "1.00", precio_unitario: String(precio), subtotal: String(precio) }],
  });
}

const registrar = (numero) =>
  entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto caro", cantidad: 1, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: CAJERO });

test("al registrar, el historial guarda el primer movimiento: sin estado -> PENDIENTE, hecho por el cajero", async () => {
  const numero = entorno.agregarFactura(1);
  const { cuerpo } = await entorno.post("/api/devoluciones", {
    factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: CAJERO,
  });
  const { rows } = await query(
    `SELECT h.estado_anterior, h.estado_nuevo, h.cambiado_por, h.cambiado_en
       FROM devoluciones.historial_estados h JOIN devoluciones.devoluciones d ON d.id = h.devolucion_id
      WHERE d.codigo = $1`,
    [cuerpo.data.codigo]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].estado_anterior, null);
  assert.equal(rows[0].estado_nuevo, "PENDIENTE");
  assert.equal(rows[0].cambiado_por, CAJERO);
  assert.ok(Math.abs(Date.now() - new Date(rows[0].cambiado_en).getTime()) < 60_000, "la hora del cambio debe ser la actual");
});

test("el limite es estricto: 500.00 NO requiere autorizacion, 500.01 si", async () => {
  const justo = await registrar(facturaConPrecio(2, 500));
  assert.equal(justo.cuerpo.data.monto_total, 500);
  assert.equal(justo.cuerpo.data.requiere_autorizacion, false);

  const pasa = await registrar(facturaConPrecio(3, 500.01));
  assert.equal(pasa.cuerpo.data.monto_total, 500.01);
  assert.equal(pasa.cuerpo.data.requiere_autorizacion, true);
});

test("montos chicos no requieren autorizacion y montos grandes si, y queda guardado en la base", async () => {
  const chica = await registrar(facturaConPrecio(4, 25));
  const grande = await registrar(facturaConPrecio(5, 1200));
  assert.equal(chica.cuerpo.data.requiere_autorizacion, false);
  assert.equal(grande.cuerpo.data.requiere_autorizacion, true);

  const { rows } = await query(`SELECT codigo, requiere_autorizacion FROM devoluciones.devoluciones WHERE codigo = ANY($1) ORDER BY codigo`, [[chica.cuerpo.data.codigo, grande.cuerpo.data.codigo]]);
  const porCodigo = Object.fromEntries(rows.map((r) => [r.codigo, r.requiere_autorizacion]));
  assert.equal(porCodigo[chica.cuerpo.data.codigo], false);
  assert.equal(porCodigo[grande.cuerpo.data.codigo], true);
});

test("el limite se puede cambiar con LIMITE_AUTORIZACION_BS", async () => {
  process.env.LIMITE_AUTORIZACION_BS = "100";
  try {
    const r = await registrar(facturaConPrecio(6, 150));
    assert.equal(r.cuerpo.data.requiere_autorizacion, true);
  } finally {
    delete process.env.LIMITE_AUTORIZACION_BS;
  }
});

test("si el guardado falla, tampoco queda historial huerfano", async () => {
  const larga = "X".repeat(250);
  const numero = entorno.agregarFactura(7, { items: [{ descripcion: larga, cantidad: "1.00", precio_unitario: "10.00", subtotal: "10.00" }] });
  const antes = (await query(`SELECT count(*)::int n FROM devoluciones.historial_estados`)).rows[0].n;
  const r = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: larga, cantidad: 1, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: CAJERO });
  assert.equal(r.status, 500);
  const despues = (await query(`SELECT count(*)::int n FROM devoluciones.historial_estados`)).rows[0].n;
  assert.equal(despues, antes);
});
