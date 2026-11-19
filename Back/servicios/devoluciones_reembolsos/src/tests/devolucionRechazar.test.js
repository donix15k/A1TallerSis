// TDSI-36: POST /api/devoluciones/:codigo/rechazar (base real; Facturacion simulado solo para el PIN).
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.rechazar@tallersis.test";
const MOTIVO_OK = "Producto usado y sin empaque original";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  entorno.supervisores.set("SUP-BLOQ", { pin: "1234", nombre: "Supervisor bloqueado", bloqueado: true });
});

test.after(() => entorno.cerrar());

async function pendiente() {
  const numero = entorno.agregarFactura(200 + ++contador);
  const { cuerpo } = await entorno.post("/api/devoluciones", {
    factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: CAJERO,
  });
  return cuerpo.data.codigo;
}

const rechazar = (codigo, extra = {}) =>
  entorno.post(`/api/devoluciones/${codigo}/rechazar`, { supervisor_id: "SUP-OK", pin: "1234", motivo_rechazo: MOTIVO_OK, ...extra });

const enBase = async (codigo) =>
  (await query(`SELECT estado, motivo_rechazo, autorizado_por FROM devoluciones.devoluciones WHERE codigo = $1`, [codigo])).rows[0];

test("con motivo y PIN correctos pasa a RECHAZADA y guarda el motivo del rechazo", async () => {
  const codigo = await pendiente();
  const { status, cuerpo } = await rechazar(codigo);
  assert.equal(status, 200);
  assert.equal(cuerpo.mensaje, "Devolución rechazada");
  assert.equal(cuerpo.data.estado, "RECHAZADA");
  assert.equal(cuerpo.data.motivo_rechazo, MOTIVO_OK);
  const base = await enBase(codigo);
  assert.equal(base.estado, "RECHAZADA");
  assert.equal(base.motivo_rechazo, MOTIVO_OK);
  assert.equal(base.autorizado_por, null); // rechazar no es autorizar
});

test("el motivo del rechazo exige al menos 10 caracteres (sin contar espacios de los extremos)", async () => {
  const codigo = await pendiente();
  for (const motivo of [undefined, "", "corto", "123456789", "   123456789   ", 12345678901234]) {
    const r = await rechazar(codigo, { motivo_rechazo: motivo });
    assert.equal(r.status, 400, `deberia rechazar ${JSON.stringify(motivo)}`);
    assert.match(r.cuerpo.mensaje, /al menos 10 caracteres/);
  }
  assert.equal((await enBase(codigo)).estado, "PENDIENTE");

  const justo = await rechazar(codigo, { motivo_rechazo: "  1234567890  " });
  assert.equal(justo.status, 200);
  assert.equal(justo.cuerpo.data.motivo_rechazo, "1234567890"); // se guarda sin los espacios
});

test("el motivo del rechazo no puede pasar de 300 caracteres", async () => {
  const codigo = await pendiente();
  const largo = await rechazar(codigo, { motivo_rechazo: "x".repeat(301) });
  assert.equal(largo.status, 400);
  assert.match(largo.cuerpo.mensaje, /300 caracteres/);
  assert.equal((await rechazar(codigo, { motivo_rechazo: "x".repeat(300) })).status, 200);
});

test("un motivo invalido NO gasta un intento de PIN (se revisa antes)", async () => {
  const codigo = await pendiente();
  const antes = entorno.intentosValidar.length;
  await rechazar(codigo, { motivo_rechazo: "corto" });
  assert.equal(entorno.intentosValidar.length, antes);
});

test("PIN incorrecto: 401 y no cambia nada", async () => {
  const codigo = await pendiente();
  const r = await rechazar(codigo, { pin: "9999" });
  assert.equal(r.status, 401);
  assert.equal(r.cuerpo.mensaje, "Usuario o PIN incorrecto");
  const base = await enBase(codigo);
  assert.equal(base.estado, "PENDIENTE");
  assert.equal(base.motivo_rechazo, null);
});

test("supervisor bloqueado: 423 y no cambia nada", async () => {
  const codigo = await pendiente();
  const r = await rechazar(codigo, { supervisor_id: "SUP-BLOQ" });
  assert.equal(r.status, 423);
  assert.equal((await enBase(codigo)).estado, "PENDIENTE");
});

test("falta usuario o PIN: 400", async () => {
  const codigo = await pendiente();
  assert.equal((await entorno.post(`/api/devoluciones/${codigo}/rechazar`, { pin: "1234", motivo_rechazo: MOTIVO_OK })).status, 400);
  assert.equal((await entorno.post(`/api/devoluciones/${codigo}/rechazar`, { supervisor_id: "SUP-OK", motivo_rechazo: MOTIVO_OK })).status, 400);
  assert.equal((await enBase(codigo)).estado, "PENDIENTE");
});

test("solo se rechazan PENDIENTES: una aprobada o ya rechazada da 409", async () => {
  const aprobada = await pendiente();
  await entorno.post(`/api/devoluciones/${aprobada}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  const intentosAntes = entorno.intentosValidar.length;
  const r1 = await rechazar(aprobada);
  assert.equal(r1.status, 409);
  assert.match(r1.cuerpo.mensaje, /ya está APROBADA/);
  assert.equal((await enBase(aprobada)).estado, "APROBADA"); // sigue aprobada

  const rechazada = await pendiente();
  await rechazar(rechazada);
  const r2 = await rechazar(rechazada);
  assert.equal(r2.status, 409);
  assert.match(r2.cuerpo.mensaje, /ya está RECHAZADA/);
  assert.equal(entorno.intentosValidar.length, intentosAntes + 1, "solo la primera vez (la valida) consulta el PIN");
});

test("aprobar y rechazar a la vez: gana uno solo", async () => {
  const codigo = await pendiente();
  const [a, r] = await Promise.all([
    entorno.post(`/api/devoluciones/${codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" }),
    rechazar(codigo),
  ]);
  assert.deepEqual([a.status, r.status].sort(), [200, 409]);
  const base = await enBase(codigo);
  assert.equal(base.estado, a.status === 200 ? "APROBADA" : "RECHAZADA");
});

test("codigo inexistente: 404; codigo invalido: 400", async () => {
  assert.equal((await rechazar("DEV-999999")).status, 404);
  assert.equal((await rechazar("hola")).status, 400);
});

test("una rechazada sale de la bandeja de pendientes y aparece como RECHAZADA con su motivo", async () => {
  const codigo = await pendiente();
  await rechazar(codigo);
  assert.ok(!(await entorno.get("/api/devoluciones?estado=PENDIENTE")).cuerpo.data.some((f) => f.codigo === codigo));
  assert.ok((await entorno.get("/api/devoluciones?estado=RECHAZADA")).cuerpo.data.some((f) => f.codigo === codigo));
  assert.equal((await entorno.get(`/api/devoluciones/${codigo}`)).cuerpo.data.motivo_rechazo, MOTIVO_OK);
});

test("una devolucion rechazada libera las unidades: se pueden volver a devolver", async () => {
  const numero = entorno.agregarFactura(300);
  const registrar = (cantidad) => entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad, estado_producto: "BUEN_ESTADO" }], motivo_id: motivoId, cajero: CAJERO });
  const primera = await registrar(5); // todo el Producto A
  assert.equal((await registrar(1)).status, 422); // no queda nada mientras la primera siga pendiente
  await rechazar(primera.cuerpo.data.codigo);
  assert.equal((await registrar(1)).status, 201); // rechazada: vuelve a estar disponible
});
