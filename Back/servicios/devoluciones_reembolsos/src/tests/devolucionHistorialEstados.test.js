// TDSI-37: cada aprobacion o rechazo queda en historial_estados, y 409 si la devolucion ya no esta PENDIENTE
// (base real; Facturacion simulado solo para el PIN).
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let motivoId;
let contador = 0;
const CAJERO = "cajero.historial2@tallersis.test";
const MOTIVO_RECHAZO = "No cumple la politica de devoluciones";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  entorno.supervisores.set("SUP-2", { pin: "5678", nombre: "Segundo supervisor" });
});

test.after(() => entorno.cerrar());

async function pendiente() {
  const numero = entorno.agregarFactura(400 + ++contador);
  const { cuerpo } = await entorno.post("/api/devoluciones", {
    factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1 }], motivo_id: motivoId, cajero: CAJERO,
  });
  return cuerpo.data.codigo;
}

const aprobar = (codigo, sup = { supervisor_id: "SUP-OK", pin: "1234" }) => entorno.post(`/api/devoluciones/${codigo}/aprobar`, sup);
const rechazar = (codigo, sup = { supervisor_id: "SUP-OK", pin: "1234" }) =>
  entorno.post(`/api/devoluciones/${codigo}/rechazar`, { ...sup, motivo_rechazo: MOTIVO_RECHAZO });

async function historial(codigo) {
  const { rows } = await query(
    `SELECT h.estado_anterior, h.estado_nuevo, h.cambiado_por, h.cambiado_en
       FROM devoluciones.historial_estados h JOIN devoluciones.devoluciones d ON d.id = h.devolucion_id
      WHERE d.codigo = $1 ORDER BY h.id`,
    [codigo]
  );
  return rows;
}

test("aprobar deja en el historial: sin estado -> PENDIENTE (cajero) y PENDIENTE -> APROBADA (supervisor)", async () => {
  const codigo = await pendiente();
  await aprobar(codigo);
  const h = await historial(codigo);
  assert.deepEqual(h.map((x) => [x.estado_anterior, x.estado_nuevo, x.cambiado_por]), [
    [null, "PENDIENTE", CAJERO],
    ["PENDIENTE", "APROBADA", "SUP-OK"],
  ]);
  assert.ok(Math.abs(Date.now() - new Date(h[1].cambiado_en).getTime()) < 60_000);
});

test("rechazar deja en el historial: PENDIENTE -> RECHAZADA, hecho por el supervisor", async () => {
  const codigo = await pendiente();
  await rechazar(codigo, { supervisor_id: "SUP-2", pin: "5678" });
  const h = await historial(codigo);
  assert.deepEqual(h.map((x) => [x.estado_anterior, x.estado_nuevo, x.cambiado_por]), [
    [null, "PENDIENTE", CAJERO],
    ["PENDIENTE", "RECHAZADA", "SUP-2"],
  ]);
});

test("la consulta de la devolucion muestra todo el historial en orden", async () => {
  const codigo = await pendiente();
  await aprobar(codigo);
  const { cuerpo } = await entorno.get(`/api/devoluciones/${codigo}`);
  assert.deepEqual(cuerpo.data.historial.map((x) => x.estado_nuevo), ["PENDIENTE", "APROBADA"]);
  assert.equal(cuerpo.data.historial[1].cambiado_por, "SUP-OK");
});

test("intentos que no cambian el estado NO dejan historial (PIN malo, motivo corto, ya resuelta)", async () => {
  const codigo = await pendiente();
  await aprobar(codigo, { supervisor_id: "SUP-OK", pin: "9999" }); // 401
  await entorno.post(`/api/devoluciones/${codigo}/rechazar`, { supervisor_id: "SUP-OK", pin: "1234", motivo_rechazo: "corto" }); // 400
  assert.equal((await historial(codigo)).length, 1, "solo el registro inicial");

  await aprobar(codigo);
  assert.equal((await historial(codigo)).length, 2);
  assert.equal((await aprobar(codigo)).status, 409);
  assert.equal((await rechazar(codigo)).status, 409);
  assert.equal((await historial(codigo)).length, 2, "los 409 no agregan filas");
});

test("409 si la devolucion ya no esta PENDIENTE, con el estado actual en el detalle", async () => {
  const codigo = await pendiente();
  await rechazar(codigo);
  const r = await aprobar(codigo);
  assert.equal(r.status, 409);
  assert.equal(r.cuerpo.detalle.estado, "RECHAZADA");
  assert.equal(r.cuerpo.detalle.codigo, codigo);
});

test("aprobar y rechazar a la vez: un solo cambio, un solo registro de historial", async () => {
  const codigo = await pendiente();
  const [a, r] = await Promise.all([aprobar(codigo), rechazar(codigo, { supervisor_id: "SUP-2", pin: "5678" })]);
  assert.deepEqual([a.status, r.status].sort(), [200, 409]);
  const h = await historial(codigo);
  assert.equal(h.length, 2, "registro inicial + exactamente un cambio");
  assert.equal(h[1].estado_nuevo, a.status === 200 ? "APROBADA" : "RECHAZADA");
});

test("si falla el registro del historial, el estado NO cambia (misma transaccion)", async () => {
  const codigo = await pendiente();
  // un usuario de 70 caracteres no cabe en historial_estados.cambiado_por (60): el INSERT del historial falla
  // DESPUES de actualizar el estado, y todo debe deshacerse
  const largo = "S".repeat(70);
  entorno.supervisores.set(largo, { pin: "1234", nombre: "Supervisor de nombre larguisimo" });
  const r = await rechazar(codigo, { supervisor_id: largo, pin: "1234" });
  assert.equal(r.status, 500);
  const { rows } = await query(`SELECT estado, motivo_rechazo FROM devoluciones.devoluciones WHERE codigo = $1`, [codigo]);
  assert.equal(rows[0].estado, "PENDIENTE", "el estado debio deshacerse");
  assert.equal(rows[0].motivo_rechazo, null);
  assert.equal((await historial(codigo)).length, 1);
});
