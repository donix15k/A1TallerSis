// TDSI-33: GET /api/devoluciones?estado=PENDIENTE (bandeja del supervisor), base real.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivos;
const codigos = {}; // nombre -> codigo
const CAJERO = "cajero.lista@tallersis.test";

async function registrar(n, { cantidad = 1, descripcion = "Producto A", cajero = CAJERO, motivoIndice = 0 } = {}) {
  const numero = entorno.agregarFactura(n);
  const { cuerpo } = await entorno.post("/api/devoluciones", {
    factura_numero: numero, items: [{ descripcion, cantidad }], motivo_id: motivos[motivoIndice].id, cajero,
  });
  return { numero, codigo: cuerpo.data.codigo };
}

test.before(async () => {
  entorno = await iniciarEntorno();
  motivos = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data;
  // tres PENDIENTES (la 2da es grande y requiere autorizacion), una APROBADA y una RECHAZADA, en este orden de llegada
  codigos.p1 = (await registrar(1)).codigo;
  codigos.p2 = (await registrar(2, { cantidad: 5, motivoIndice: 1 })).codigo;
  codigos.p3 = (await registrar(3, { cajero: "otro.cajero@tallersis.test", motivoIndice: 2 })).codigo;
  codigos.aprobada = (await registrar(4)).codigo;
  codigos.rechazada = (await registrar(5)).codigo;
  await query(`UPDATE devoluciones.devoluciones SET estado = 'APROBADA' WHERE codigo = $1`, [codigos.aprobada]);
  await query(`UPDATE devoluciones.devoluciones SET estado = 'RECHAZADA' WHERE codigo = $1`, [codigos.rechazada]);
});

test.after(() => entorno.cerrar());

const nuestros = (filas) => filas.filter((f) => Object.values(codigos).includes(f.codigo));

test("estado=PENDIENTE trae solo las pendientes, con los datos de la bandeja", async () => {
  const { status, cuerpo } = await entorno.get("/api/devoluciones?estado=PENDIENTE");
  assert.equal(status, 200);
  const filas = nuestros(cuerpo.data);
  assert.deepEqual(filas.map((f) => f.codigo), [codigos.p1, codigos.p2, codigos.p3]);
  assert.ok(cuerpo.data.every((f) => f.estado === "PENDIENTE"));

  const f = filas[0];
  assert.equal(f.factura_numero, entorno.numero(1));
  assert.equal(f.cajero, CAJERO);
  assert.equal(f.monto_total, 10);
  assert.deepEqual(f.motivo, motivos[0]);
  assert.ok(f.fecha_solicitud);
  assert.equal(f.requiere_autorizacion, false);
  assert.equal(f.tipo, "PARCIAL");
});

test("la cola de pendientes va de la mas antigua a la mas nueva", async () => {
  const { cuerpo } = await entorno.get("/api/devoluciones?estado=PENDIENTE");
  const fechas = cuerpo.data.map((f) => new Date(f.fecha_solicitud).getTime());
  assert.deepEqual(fechas, [...fechas].sort((a, b) => a - b));
});

test("el contador (total) coincide con las pendientes que hay", async () => {
  const { cuerpo } = await entorno.get("/api/devoluciones?estado=PENDIENTE");
  assert.equal(cuerpo.total, cuerpo.data.length);
  const { rows } = await query(`SELECT count(*)::int n FROM devoluciones.devoluciones WHERE estado = 'PENDIENTE'`);
  assert.equal(cuerpo.total, rows[0].n);
});

test("otros estados: APROBADA y RECHAZADA, sin distinguir mayusculas", async () => {
  const aprobadas = await entorno.get("/api/devoluciones?estado=aprobada");
  assert.deepEqual(nuestros(aprobadas.cuerpo.data).map((f) => f.codigo), [codigos.aprobada]);
  const rechazadas = await entorno.get("/api/devoluciones?estado=RECHAZADA");
  assert.deepEqual(nuestros(rechazadas.cuerpo.data).map((f) => f.codigo), [codigos.rechazada]);
});

test("sin estado trae todas (las mas recientes primero)", async () => {
  const { cuerpo } = await entorno.get("/api/devoluciones");
  assert.equal(nuestros(cuerpo.data).length, 5);
  const fechas = cuerpo.data.map((f) => new Date(f.fecha_solicitud).getTime());
  assert.deepEqual(fechas, [...fechas].sort((a, b) => b - a));
});

test("marca cuales requieren la autorizacion del supervisor", async () => {
  // una pendiente de mas de 500 Bs
  const numero = entorno.agregarFactura(6, { items: [{ descripcion: "Caro", cantidad: "1.00", precio_unitario: "900.00", subtotal: "900.00" }] });
  const r = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Caro", cantidad: 1 }], motivo_id: motivos[0].id, cajero: CAJERO });
  const { cuerpo } = await entorno.get("/api/devoluciones?estado=PENDIENTE");
  const fila = cuerpo.data.find((f) => f.codigo === r.cuerpo.data.codigo);
  assert.equal(fila.requiere_autorizacion, true);
  assert.equal(fila.monto_total, 900);
});

test("limite acota las filas pero el total sigue siendo el completo", async () => {
  const { cuerpo } = await entorno.get("/api/devoluciones?estado=PENDIENTE&limite=2");
  assert.equal(cuerpo.data.length, 2);
  assert.ok(cuerpo.total >= 4);
});

test("estado o limite invalidos: 400", async () => {
  assert.equal((await entorno.get("/api/devoluciones?estado=CUALQUIERA")).status, 400);
  for (const limite of ["0", "-1", "abc", "1.5", "5000"]) {
    assert.equal((await entorno.get(`/api/devoluciones?limite=${limite}`)).status, 400, `limite ${limite}`);
  }
});
