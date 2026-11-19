// TDSI-10: conexion real a Supabase y schema "devoluciones" (sin mocks).
const test = require("node:test");
const assert = require("node:assert/strict");
const { query, pool, verificarEsquema } = require("../config/db");

// Las tablas que el servicio necesita (se pueden agregar mas en tareas nuevas: vales_usos, envios_contabilidad_nc...).
const TABLAS = [
  "devolucion_items", "devoluciones", "envios_comprobante", "envios_pasarela", "historial_estados",
  "motivos", "notas_credito", "notificaciones_inventario", "reembolsos", "vales_compra", "vales_usos", "envios_contabilidad_nc",
];

test.after(() => pool.end());

test("el schema devoluciones existe con todas las tablas del script", async () => {
  const { rows } = await query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'devoluciones' ORDER BY table_name`
  );
  assert.deepEqual(rows.map((r) => r.table_name), [...TABLAS].sort());
  assert.equal((await verificarEsquema()).tablas, TABLAS.length);
});

test("los motivos predefinidos estan cargados", async () => {
  const { rows } = await query(`SELECT nombre FROM devoluciones.motivos WHERE activo ORDER BY id`);
  const nombres = rows.map((r) => r.nombre);
  for (const esperado of ["Producto defectuoso", "Producto equivocado", "Cliente se arrepintio", "Otro"]) {
    assert.ok(nombres.includes(esperado), `falta el motivo "${esperado}"`);
  }
});

test("la cabecera de devoluciones tiene las columnas que usan las historias (factura, plazo, estado)", async () => {
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'devoluciones' AND table_name = 'devoluciones'`
  );
  const columnas = rows.map((r) => r.column_name);
  for (const c of ["factura_numero", "fecha_venta", "dentro_de_plazo", "estado", "metodo_pago_original", "monto_total"]) {
    assert.ok(columnas.includes(c), `falta la columna ${c}`);
  }
});
