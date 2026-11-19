// TDSI-80: GET /api/devoluciones/:codigo/historial. BD real, Facturacion simulado; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.linea@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
});
test.after(() => entorno.cerrar());

async function registrar() {
  const numero = entorno.agregarFactura(300 + ++contador, { metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 2 }], motivo_id: motivoId, cajero: CAJERO });
  return cuerpo.data.codigo;
}
const historial = (codigo) => entorno.get(`/api/devoluciones/${codigo}/historial`);

test("una devolucion recien registrada: un solo evento (registro) y el resumen con quien la registro", async () => {
  const codigo = await registrar();
  const r = await historial(codigo);
  assert.equal(r.status, 200);
  const d = r.cuerpo.data;
  assert.deepEqual([d.codigo, d.estado_actual], [codigo, "PENDIENTE"]);
  assert.deepEqual(d.eventos.map((e) => [e.estado_anterior, e.estado_nuevo, e.cambiado_por]), [[null, "PENDIENTE", CAJERO]]);
  assert.ok(d.eventos[0].cambiado_en);
  assert.equal(d.resumen.registrada_por, CAJERO);
  assert.deepEqual([d.resumen.resuelta_por, d.resumen.reembolsada_por], [null, null]);
});

test("registrada, aprobada y reembolsada: los tres pasos en orden, con quien hizo cada uno y la hora del reembolso", async () => {
  const codigo = await registrar();
  await entorno.post(`/api/devoluciones/${codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  await entorno.post(`/api/devoluciones/${codigo}/reembolsar`, { cajero: "cajero.reembolsa@tallersis.test" });
  const d = (await historial(codigo)).cuerpo.data;
  assert.equal(d.estado_actual, "PROCESADA");
  assert.deepEqual(d.eventos.map((e) => [e.estado_anterior, e.estado_nuevo, e.cambiado_por]), [
    [null, "PENDIENTE", CAJERO],
    ["PENDIENTE", "APROBADA", "SUP-OK"],
    ["APROBADA", "PROCESADA", "cajero.reembolsa@tallersis.test"],
  ]);
  const tiempos = d.eventos.map((e) => new Date(e.cambiado_en).getTime());
  assert.deepEqual(tiempos, [...tiempos].sort((a, b) => a - b)); // cronologico
  assert.deepEqual(
    [d.resumen.registrada_por, d.resumen.resuelta_como, d.resumen.resuelta_por, d.resumen.reembolsada_por],
    [CAJERO, "APROBADA", "SUP-OK", "cajero.reembolsa@tallersis.test"]
  );
  assert.equal(d.resumen.reembolsada_en, d.eventos[2].cambiado_en);
});

test("una devolucion rechazada muestra quien la rechazo y no tiene reembolso", async () => {
  const codigo = await registrar();
  await entorno.post(`/api/devoluciones/${codigo}/rechazar`, { supervisor_id: "SUP-OK", pin: "1234", motivo_rechazo: "El producto no es de esta tienda" });
  const d = (await historial(codigo)).cuerpo.data;
  assert.deepEqual([d.estado_actual, d.resumen.resuelta_como, d.resumen.resuelta_por, d.resumen.reembolsada_por], ["RECHAZADA", "RECHAZADA", "SUP-OK", null]);
});

test("el historial solo se agrega: ya hay filas y no se expone ningun metodo para modificarlas o borrarlas", async () => {
  const codigo = await registrar();
  const r1 = (await historial(codigo)).cuerpo.data.eventos.length;
  for (const metodo of ["PUT", "PATCH", "DELETE", "POST"]) {
    const res = await fetch(`${entorno.base}/api/devoluciones/${codigo}/historial`, { method: metodo, headers: { "Content-Type": "application/json" }, body: metodo === "DELETE" ? undefined : "{}" });
    assert.ok([404, 405].includes(res.status), metodo);
  }
  assert.equal((await historial(codigo)).cuerpo.data.eventos.length, r1);
  const { rows } = await query(`SELECT count(*)::int n FROM devoluciones.historial_estados h JOIN devoluciones.devoluciones d ON d.id = h.devolucion_id WHERE d.codigo = $1`, [codigo]);
  assert.equal(rows[0].n, r1);
});

test("codigo inexistente: 404", async () => {
  assert.equal((await historial("DEV-999999")).status, 404);
});
