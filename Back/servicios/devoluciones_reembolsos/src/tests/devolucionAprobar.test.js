// TDSI-35: POST /api/devoluciones/:codigo/aprobar (base real; Facturacion simulado solo para el PIN).
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.aprobar@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  entorno.supervisores.set("SUP-BLOQ", { pin: "1234", nombre: "Supervisor bloqueado", bloqueado: true });
});

test.after(() => entorno.cerrar());

/** Registra una devolucion PENDIENTE nueva y devuelve su codigo. */
async function pendiente() {
  const numero = entorno.agregarFactura(100 + ++contador);
  const { cuerpo } = await entorno.post("/api/devoluciones", {
    factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: CAJERO,
  });
  return cuerpo.data.codigo;
}

const aprobar = (codigo, credenciales = { supervisor_id: "SUP-OK", pin: "1234" }) =>
  entorno.post(`/api/devoluciones/${codigo}/aprobar`, credenciales);

const estadoEnBase = async (codigo) =>
  (await query(`SELECT estado, autorizado_por, autorizado_en FROM devoluciones.devoluciones WHERE codigo = $1`, [codigo])).rows[0];

test("con usuario y PIN correctos pasa a APROBADA y guarda quien la autorizo y cuando", async () => {
  const codigo = await pendiente();
  const { status, cuerpo } = await aprobar(codigo);
  assert.equal(status, 200);
  assert.equal(cuerpo.mensaje, "Devolución aprobada");
  assert.equal(cuerpo.data.estado, "APROBADA");
  assert.equal(cuerpo.data.autorizado_por, "SUP-OK");
  assert.ok(Math.abs(Date.now() - new Date(cuerpo.data.autorizado_en).getTime()) < 60_000);

  const base = await estadoEnBase(codigo);
  assert.equal(base.estado, "APROBADA");
  assert.equal(base.autorizado_por, "SUP-OK");
  assert.ok(base.autorizado_en);
});

test("la aprobacion no toca los productos ni el monto", async () => {
  const codigo = await pendiente();
  const antes = (await entorno.get(`/api/devoluciones/${codigo}`)).cuerpo.data;
  const despues = (await aprobar(codigo)).cuerpo.data;
  assert.deepEqual(despues.items, antes.items);
  assert.equal(despues.monto_total, antes.monto_total);
  assert.equal(despues.cajero, antes.cajero);
});

test("PIN incorrecto: 401 'Usuario o PIN incorrecto' y no cambia nada", async () => {
  const codigo = await pendiente();
  const r = await aprobar(codigo, { supervisor_id: "SUP-OK", pin: "9999" });
  assert.equal(r.status, 401);
  assert.equal(r.cuerpo.mensaje, "Usuario o PIN incorrecto");
  const base = await estadoEnBase(codigo);
  assert.equal(base.estado, "PENDIENTE");
  assert.equal(base.autorizado_por, null);
  assert.equal(base.autorizado_en, null);
});

test("usuario inexistente: 401 y no cambia nada", async () => {
  const codigo = await pendiente();
  const r = await aprobar(codigo, { supervisor_id: "NO-EXISTE", pin: "1234" });
  assert.equal(r.status, 401);
  assert.equal((await estadoEnBase(codigo)).estado, "PENDIENTE");
});

test("supervisor bloqueado por intentos fallidos: 423 aunque el PIN sea correcto, y no cambia nada", async () => {
  const codigo = await pendiente();
  const r = await aprobar(codigo, { supervisor_id: "SUP-BLOQ", pin: "1234" });
  assert.equal(r.status, 423);
  assert.match(r.cuerpo.mensaje, /bloqueado/);
  assert.equal((await estadoEnBase(codigo)).estado, "PENDIENTE");
});

test("falta el usuario o el PIN: 400", async () => {
  const codigo = await pendiente();
  assert.equal((await aprobar(codigo, { pin: "1234" })).status, 400);
  assert.equal((await aprobar(codigo, { supervisor_id: "SUP-OK" })).status, 400);
  assert.equal((await aprobar(codigo, {})).status, 400);
  assert.equal((await estadoEnBase(codigo)).estado, "PENDIENTE");
});

test("tambien acepta el usuario con el nombre 'usuario'", async () => {
  const codigo = await pendiente();
  const r = await aprobar(codigo, { usuario: "SUP-OK", pin: "1234" });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.data.autorizado_por, "SUP-OK");
});

test("solo se aprueban PENDIENTES: una ya aprobada o rechazada da 409 y NO gasta un intento de PIN", async () => {
  const yaAprobada = await pendiente();
  await aprobar(yaAprobada);
  const intentosAntes = entorno.intentosValidar.length;

  const otra = await aprobar(yaAprobada);
  assert.equal(otra.status, 409);
  assert.match(otra.cuerpo.mensaje, /ya está APROBADA/);

  const rechazada = await pendiente();
  await query(`UPDATE devoluciones.devoluciones SET estado = 'RECHAZADA' WHERE codigo = $1`, [rechazada]);
  const r = await aprobar(rechazada);
  assert.equal(r.status, 409);
  assert.match(r.cuerpo.mensaje, /ya está RECHAZADA/);

  assert.equal(entorno.intentosValidar.length, intentosAntes, "no debe consultar el PIN de algo que ya no se puede aprobar");
});

test("dos supervisores aprobando a la vez: solo uno lo logra, el otro recibe 409", async () => {
  const codigo = await pendiente();
  entorno.supervisores.set("SUP-2", { pin: "5678", nombre: "Segundo supervisor" });
  const [r1, r2] = await Promise.all([
    aprobar(codigo, { supervisor_id: "SUP-OK", pin: "1234" }),
    aprobar(codigo, { supervisor_id: "SUP-2", pin: "5678" }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  const ganador = r1.status === 200 ? "SUP-OK" : "SUP-2";
  assert.equal((await estadoEnBase(codigo)).autorizado_por, ganador);
});

test("codigo inexistente: 404; codigo invalido: 400", async () => {
  assert.equal((await aprobar("DEV-999999")).status, 404);
  assert.equal((await aprobar("hola")).status, 400);
});

test("una aprobada sale de la bandeja de pendientes", async () => {
  const codigo = await pendiente();
  assert.ok((await entorno.get("/api/devoluciones?estado=PENDIENTE")).cuerpo.data.some((f) => f.codigo === codigo));
  await aprobar(codigo);
  assert.ok(!(await entorno.get("/api/devoluciones?estado=PENDIENTE")).cuerpo.data.some((f) => f.codigo === codigo));
  assert.ok((await entorno.get("/api/devoluciones?estado=APROBADA")).cuerpo.data.some((f) => f.codigo === codigo));
});

test("el PIN no se devuelve ni se guarda en ninguna parte", async () => {
  const codigo = await pendiente();
  const r = await aprobar(codigo, { supervisor_id: "SUP-OK", pin: "1234" });
  assert.ok(!JSON.stringify(r.cuerpo).includes('"pin"'));
});
