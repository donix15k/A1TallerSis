// TDSI-102: estado del producto devuelto (BUEN_ESTADO o DEFECTUOSO), obligatorio por cada producto en POST /api/devoluciones.
// BD real, Facturacion simulado; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.estado@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});
test.after(() => entorno.cerrar());

const items2 = [
  { descripcion: "Producto A", precio_unitario: "10.00" },
  { descripcion: "Producto B", precio_unitario: "25.00" },
].map((p) => ({ ...p, cantidad: "5.00", subtotal: String(5 * Number(p.precio_unitario)) }));

function registrar(items) {
  const numero = entorno.agregarFactura(30 + ++contador, { items: items2 });
  return entorno.post("/api/devoluciones", { factura_numero: numero, items, motivo_id: motivoId, cajero: CAJERO });
}

test("cada producto lleva su estado y se guarda y se devuelve en el detalle (uno en buen estado y otro defectuoso)", async () => {
  const r = await registrar([
    { descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" },
    { descripcion: "Producto B", cantidad: 2, estado_producto: "DEFECTUOSO" },
  ]);
  assert.equal(r.status, 201);
  assert.deepEqual(r.cuerpo.data.items.map((i) => [i.descripcion, i.estado_producto]), [["Producto A", "BUEN_ESTADO"], ["Producto B", "DEFECTUOSO"]]);
  const d = (await entorno.get(`/api/devoluciones/${r.cuerpo.data.codigo}`)).cuerpo.data;
  assert.deepEqual(d.items.map((i) => [i.descripcion, i.estado_producto]), [["Producto A", "BUEN_ESTADO"], ["Producto B", "DEFECTUOSO"]]);
  const { rows } = await query(`SELECT i.estado_producto FROM devoluciones.devolucion_items i JOIN devoluciones.devoluciones d ON d.id = i.devolucion_id WHERE d.codigo = $1 ORDER BY i.id`, [r.cuerpo.data.codigo]);
  assert.deepEqual(rows.map((x) => x.estado_producto), ["BUEN_ESTADO", "DEFECTUOSO"]);
});

test("es OBLIGATORIO: sin estado_producto responde 400 y no se registra la devolucion", async () => {
  const r = await registrar([{ descripcion: "Producto A", cantidad: 1 }]);
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.mensaje, /Indique el estado de "Producto A": BUEN_ESTADO o DEFECTUOSO/);
  assert.deepEqual(r.cuerpo.detalle.estados, ["BUEN_ESTADO", "DEFECTUOSO"]);
  const mal = await registrar([{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }, { descripcion: "Producto B", cantidad: 1 }]);
  assert.equal(mal.status, 400); // alcanza con que a UN producto le falte
  assert.match(mal.cuerpo.mensaje, /"Producto B"/);
});

test("un valor que no es BUEN_ESTADO ni DEFECTUOSO da 400", async () => {
  for (const valor of ["ROTO", "bueno", 5, true, "BUEN_ESTADO_Y_ROTO"]) {
    const r = await registrar([{ descripcion: "Producto A", cantidad: 1, estado_producto: valor }]);
    assert.equal(r.status, 400, String(valor));
    assert.match(r.cuerpo.mensaje, /debe ser BUEN_ESTADO o DEFECTUOSO/);
  }
});

test("acepta minusculas y espacios: 'buen estado' y ' defectuoso ' se guardan normalizados", async () => {
  const r = await registrar([
    { descripcion: "Producto A", cantidad: 1, estado_producto: "buen estado" },
    { descripcion: "Producto B", cantidad: 1, estado_producto: " defectuoso " },
  ]);
  assert.equal(r.status, 201);
  assert.deepEqual(r.cuerpo.data.items.map((i) => i.estado_producto), ["BUEN_ESTADO", "DEFECTUOSO"]);
});

test("el estado se valida junto con lo demas: un producto inexistente sigue dando su error y las devoluciones viejas quedaron BUEN_ESTADO", async () => {
  const r = await registrar([{ descripcion: "No existe", cantidad: 1, estado_producto: "DEFECTUOSO" }]);
  assert.ok([400, 404, 422].includes(r.status));
  const { rows } = await query(`SELECT column_default, is_nullable FROM information_schema.columns WHERE table_schema = 'devoluciones' AND table_name = 'devolucion_items' AND column_name = 'estado_producto'`);
  assert.match(rows[0].column_default, /BUEN_ESTADO/); // las filas anteriores a TDSI-102 quedan BUEN_ESTADO
  assert.equal(rows[0].is_nullable, "NO");
});
