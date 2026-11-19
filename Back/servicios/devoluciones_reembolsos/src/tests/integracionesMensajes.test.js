// TDSI-126: GET /api/integraciones/mensajes de Devoluciones (envios a Contabilidad, Compras y Marketplace en formato comun).
// Pub/Sub FALSO; BD real; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const cfgCompras = require("../config/compras");
const cfgMarketplace = require("../config/marketplace");
const { iniciarEntorno } = require("./helpers/entorno");

const TOPICO_C = "projects/project-test-12345/topics/ucb-sis323-sub-c";
const TOPICO_E = "projects/project-test-12345/topics/ucb-sis323-sub-e";
let entorno;
let motivoId;
let contador = 0;
let comprasOriginal;
let marketplaceOriginal;
const CAJERO = "cajero.integ@tallersis.test";

test.before(async () => {
  entorno = await iniciarEntorno();
  motivoId = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  comprasOriginal = cfgCompras.PUBSUB_TOPIC;
  marketplaceOriginal = cfgMarketplace.PUBSUB_TOPIC;
  cfgCompras.PUBSUB_TOPIC = TOPICO_C;
  cfgMarketplace.PUBSUB_TOPIC = TOPICO_E;
});
test.beforeEach(() => { entorno.pubsub.falla = null; });
test.after(async () => {
  cfgCompras.PUBSUB_TOPIC = comprasOriginal;
  cfgMarketplace.PUBSUB_TOPIC = marketplaceOriginal;
  await entorno.cerrar();
});

async function procesada({ marketplace = false, fallaPubsub = null } = {}) {
  const numero = entorno.agregarFactura(90 + ++contador, { canal: marketplace ? "Online" : "Presencial", metodosPago: [{ metodo: "QR", monto: 100 }] });
  const { cuerpo } = await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1, estado_producto: "DEFECTUOSO" }], motivo_id: motivoId, cajero: marketplace ? "MARKETPLACE" : CAJERO });
  if (marketplace) await query(`UPDATE devoluciones.devoluciones SET origen = 'MARKETPLACE', orden_id = $2 WHERE codigo = $1`, [cuerpo.data.codigo, `ORD-${cuerpo.data.codigo}`]);
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/aprobar`, { supervisor_id: "SUP-OK", pin: "1234" });
  entorno.pubsub.falla = fallaPubsub;
  await entorno.post(`/api/devoluciones/${cuerpo.data.codigo}/reembolsar`, { cajero: CAJERO });
  entorno.pubsub.falla = null;
  return cuerpo.data.codigo;
}
const mensajes = async () => (await entorno.get("/api/integraciones/mensajes")).cuerpo.data;
const deDevolucion = (lista, codigo) => lista.filter((m) => m.devolucion === codigo);

test("una devolucion de la tienda genera DOS mensajes: la nota de credito (Contabilidad, D) y los productos devueltos (Compras, C)", async () => {
  const codigo = await procesada();
  const ms = deDevolucion(await mensajes(), codigo).sort((a, b) => a.grupo.localeCompare(b.grupo));
  assert.deepEqual(ms.map((m) => [m.fuente, m.grupo, m.tipo, m.estado, m.origen]), [
    ["compras", "C", "PRODUCTOS_DEVUELTOS", "Enviado", "devoluciones"],
    ["contabilidad", "D", "NOTA_CREDITO", "Enviado", "devoluciones"],
  ]);
  for (const m of ms) {
    assert.match(m.id, /^(compras|contabilidad)-\d+$/);
    assert.match(m.message_id, /^fake-msg-\d+$/);
    assert.equal(m.puede_reenviar, false);
    assert.ok(m.datos && m.datos.tipo_operacion); // el contenido enviado
  }
  assert.match(ms.find((m) => m.fuente === "contabilidad").referencia, /^NC-\d{6}$/);
  assert.equal(ms.find((m) => m.fuente === "compras").referencia, codigo);
});

test("una devolucion del Marketplace suma el aviso DEVOLUCION_RESUELTA (E)", async () => {
  const codigo = await procesada({ marketplace: true });
  const ms = deDevolucion(await mensajes(), codigo);
  assert.deepEqual(ms.map((m) => m.grupo).sort(), ["C", "D", "E"]);
  assert.deepEqual(ms.filter((m) => m.grupo === "E").map((m) => [m.tipo, m.estado, m.detalle.resultado]), [["DEVOLUCION_RESUELTA", "Enviado", "APROBADA"]]);
});

test("estados: Error y Pendiente se ven tal cual (solo Error se puede reenviar) y la respuesta de Contabilidad/Compras es Respondido", async () => {
  const caida = await procesada({ fallaPubsub: Object.assign(new Error("UNAVAILABLE"), { code: 14 }) });
  const sinPermiso = await procesada({ fallaPubsub: Object.assign(new Error("PERMISSION_DENIED"), { code: 7 }) });
  const lista = await mensajes();
  assert.deepEqual(deDevolucion(lista, caida).map((m) => [m.estado, m.puede_reenviar, m.intentos]), [["Pendiente", false, 1], ["Pendiente", false, 1]]);
  const e = deDevolucion(lista, sinPermiso);
  assert.deepEqual(e.map((m) => [m.estado, m.puede_reenviar]), [["Error", true], ["Error", true]]);
  assert.match(e[0].error, /PERMISSION_DENIED/);

  const ok = await procesada();
  await query(`UPDATE devoluciones.envios_contabilidad_nc SET resultado = 'registrado', numero_asiento = 'A-5' WHERE nota_credito_id = (SELECT n.id FROM devoluciones.notas_credito n JOIN devoluciones.devoluciones d ON d.id = n.devolucion_id WHERE d.codigo = $1)`, [ok]);
  await query(`UPDATE devoluciones.envios_compras_dev SET acuse = 'RECLAMO_REGISTRADO', numero_reclamo = 'R-9', estado = 'Recibido' WHERE devolucion_id = (SELECT id FROM devoluciones.devoluciones WHERE codigo = $1)`, [ok]);
  const r = deDevolucion(await mensajes(), ok);
  assert.deepEqual(r.map((m) => [m.fuente, m.estado]).sort(), [["compras", "Respondido"], ["contabilidad", "Respondido"]]);
  assert.equal(r.find((m) => m.fuente === "contabilidad").detalle.numero_asiento, "A-5");
  assert.equal(r.find((m) => m.fuente === "compras").detalle.numero_reclamo, "R-9");
});

test("solo el administrador: sin token 401, cajero 403", async () => {
  assert.equal((await fetch(`${entorno.base}/api/integraciones/mensajes`)).status, 401);
  assert.equal((await fetch(`${entorno.base}/api/integraciones/mensajes`, { headers: { Authorization: "Bearer CAJERO-TEST" } })).status, 403);
});
