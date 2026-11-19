// TDSI-114: solicitud de devolucion del Marketplace -> devolucion PENDIENTE con origen MARKETPLACE. BD real; Facturacion
// y Gestion de Pagos son servidores HTTP locales (las ordenes online son de mentira); limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { query } = require("../config/db");
const { interpretar } = require("../services/solicitudMarketplaceMensaje");
const { procesarMensaje, registrarSolicitud } = require("../services/solicitudesMarketplaceService");
const { hace } = require("./helpers/entorno");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let pagos;
let ordenes; // orden_id -> orden que "tiene" Gestion de Pagos
let contador = 0;
const SUF = String(Date.now()).slice(-7);

test.before(async () => {
  entorno = await iniciarEntorno();
  pagos = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const orden = decodeURIComponent(req.url.split("/").pop());
    if (!ordenes.has(orden)) { res.statusCode = 404; return res.end(JSON.stringify({ ok: false, mensaje: "No existe la orden" })); }
    res.end(JSON.stringify({ ok: true, data: ordenes.get(orden) }));
  });
  await new Promise((r) => pagos.listen(0, r));
  process.env.GESTION_PAGOS_URL = `http://localhost:${pagos.address().port}`;
});
test.beforeEach(() => { ordenes = new Map(); });
test.after(async () => {
  pagos.closeAllConnections();
  await new Promise((r) => pagos.close(r));
  await entorno.cerrar();
});

/** Una orden online con su factura en el Facturacion simulado (5 x Producto A a 10 Bs y 2 x Producto B a 25 Bs). */
function orden({ estado = "Pagado", conFactura = true, fechaFactura, metodo = "QR" } = {}) {
  const id = `ORD-${SUF}-${++contador}`;
  const numero = conFactura ? entorno.agregarFactura(400 + contador, { canal: "Online", metodosPago: [{ metodo, monto: 100 }], ...(fechaFactura ? { fecha: fechaFactura } : {}) }) : null;
  ordenes.set(id, {
    orden_id: id, estado, total: 100, metodo_pago: metodo, numero_factura: numero, factura_emitida: Boolean(numero),
    items: [{ sku: "SKU-A", descripcion: "Producto A", cantidad: 5, precio_unitario: 10, subtotal: 50 }, { sku: "SKU-B", descripcion: "Producto B", cantidad: 2, precio_unitario: 25, subtotal: 50 }],
  });
  return { id, numero };
}
const solicitud = (o, extra = {}) => ({ id: `SOL-${SUF}-${contador}`, orden_id: o.id, productos: [{ descripcion: "Producto A", cantidad: 2 }], motivo: "Producto defectuoso", observaciones: null, ...extra });
const mensaje = (o, extra = {}) => JSON.stringify({ tipo: "SOLICITUD_DEVOLUCION", referencia_externa: `SOL-${SUF}-${contador}`, datos: { orden_id: o.id, productos: [{ descripcion: "Producto A", cantidad: 2 }], motivo: "Producto defectuoso", ...extra } });
const fila = async (codigo) => (await query(`SELECT origen, orden_id, solicitud_externa, estado, creado_por, factura_numero, monto_total::float AS monto FROM devoluciones.devoluciones WHERE codigo = $1`, [codigo])).rows[0];

test("interpretar: reconoce SOLICITUD_DEVOLUCION (tipo, tipo_mensaje o tipo_operacion) y normaliza orden, productos y motivo", () => {
  const s = interpretar(JSON.stringify({ tipo_mensaje: "solicitud devolucion", referencia_externa: "SOL-9", datos: { orden: "ORD-1", items: [{ nombre: "Mouse", cantidad: "2" }, { sku: "SKU-9", cantidad: 1, estado_producto: "DEFECTUOSO" }], motivo: " Otro ", observaciones: " roto " } }));
  assert.deepEqual(s, {
    id: "SOL-9", orden_id: "ORD-1", motivo: "Otro", observaciones: "roto",
    productos: [{ descripcion: "Mouse", sku: null, cantidad: 2, estado_producto: null }, { descripcion: null, sku: "SKU-9", cantidad: 1, estado_producto: "DEFECTUOSO" }],
  });
  assert.equal(interpretar(JSON.stringify({ tipo_operacion: "SOLICITUD_DEVOLUCION", orden_id: "ORD-2", productos: [{ descripcion: "X", cantidad: 1 }] })).id, "MKT-ORD-2"); // sin id: se usa la orden
});

test("interpretar: lo que no es una solicitud (otros mensajes de la suscripcion compartida) da null; lo mal formado lanza 400", () => {
  for (const t of ["no es json", "null", "[]", JSON.stringify({ tipo: "VENTA", orden_id: "O" }), JSON.stringify({ sistema_origen: "CONTABILIDAD", tipo_mensaje: "resultado_documento" })]) assert.equal(interpretar(t), null, t);
  const mal = [
    { datos: { productos: [{ descripcion: "X", cantidad: 1 }] } }, // sin orden
    { datos: { orden_id: "O" } }, // sin productos
    { datos: { orden_id: "O", productos: [] } },
    { datos: { orden_id: "O", productos: [{ descripcion: "X", cantidad: 0 }] } },
    { datos: { orden_id: "O", productos: [{ descripcion: "X", cantidad: "abc" }] } },
    { datos: { orden_id: "O", productos: [{ cantidad: 1 }] } }, // sin descripcion ni sku
    { datos: { orden_id: "O".repeat(61), productos: [{ descripcion: "X", cantidad: 1 }] } },
  ];
  for (const m of mal) assert.throws(() => interpretar(JSON.stringify({ tipo: "SOLICITUD_DEVOLUCION", ...m })), (e) => e.status === 400, JSON.stringify(m));
});

test("una solicitud valida crea la devolucion PENDIENTE con origen MARKETPLACE, su orden y el monto de la factura", async () => {
  const o = orden();
  const r = await procesarMensaje({ texto: mensaje(o) });
  assert.equal(r.propio, true);
  assert.equal(r.resultado.duplicada, false);
  const f = await fila(r.resultado.codigo);
  assert.deepEqual([f.origen, f.orden_id, f.estado, f.creado_por, f.factura_numero, f.monto], ["MARKETPLACE", o.id, "PENDIENTE", "MARKETPLACE", o.numero, 20]);
  const d = (await entorno.get(`/api/devoluciones/${r.resultado.codigo}`)).cuerpo.data;
  assert.deepEqual([d.origen, d.orden_id], ["MARKETPLACE", o.id]);
  assert.deepEqual(d.items.map((i) => [i.descripcion, i.cantidad, i.estado_producto]), [["Producto A", 2, "BUEN_ESTADO"]]);
  assert.equal(d.motivo.nombre, "Producto defectuoso");
});

test("los productos pueden venir por SKU (se completa la descripcion con la de la orden) y con su estado", async () => {
  const o = orden();
  const r = await registrarSolicitud(solicitud(o, { productos: [{ descripcion: null, sku: "SKU-B", cantidad: 1, estado_producto: "DEFECTUOSO" }] }));
  const d = (await entorno.get(`/api/devoluciones/${r.codigo}`)).cuerpo.data;
  assert.deepEqual(d.items.map((i) => [i.descripcion, i.estado_producto]), [["Producto B", "DEFECTUOSO"]]);
  await assert.rejects(registrarSolicitud(solicitud(o, { id: `SOL-X-${SUF}`, productos: [{ descripcion: null, sku: "SKU-NO", cantidad: 1 }] })), (e) => e.status === 422 && /SKU SKU-NO/.test(e.message));
});

test("un motivo que no esta en el catalogo se registra como 'Otro'", async () => {
  const o = orden();
  const r = await registrarSolicitud(solicitud(o, { motivo: "me llego tarde" }));
  assert.equal((await entorno.get(`/api/devoluciones/${r.codigo}`)).cuerpo.data.motivo.nombre, "Otro");
});

test("la MISMA solicitud no se registra dos veces: ni repetida ni llegando a la vez", async () => {
  const o = orden();
  const s = solicitud(o, { id: `SOL-DUP-${SUF}` });
  const primera = await registrarSolicitud(s);
  const segunda = await registrarSolicitud(s);
  assert.deepEqual([primera.duplicada, segunda.duplicada, segunda.codigo], [false, true, primera.codigo]);

  const o2 = orden();
  const s2 = solicitud(o2, { id: `SOL-CARRERA-${SUF}` });
  const [a, b] = await Promise.all([registrarSolicitud(s2), registrarSolicitud(s2)]);
  assert.equal(a.codigo, b.codigo);
  assert.deepEqual([a.duplicada, b.duplicada].sort(), [false, true]);
  assert.equal((await query(`SELECT count(*)::int n FROM devoluciones.devoluciones WHERE solicitud_externa = ANY($1)`, [[`SOL-DUP-${SUF}`, `SOL-CARRERA-${SUF}`]])).rows[0].n, 2);
});

test("la orden debe existir en las ventas online (404), no estar anulada y tener factura emitida (422)", async () => {
  await assert.rejects(registrarSolicitud(solicitud({ id: "ORD-NO-EXISTE" }, { id: `SOL-A-${SUF}` })), (e) => e.status === 404);
  const anulada = orden({ estado: "Anulado" });
  await assert.rejects(registrarSolicitud(solicitud(anulada, { id: `SOL-B-${SUF}` })), (e) => e.status === 422 && /anulada/.test(e.message));
  const sinFactura = orden({ conFactura: false });
  await assert.rejects(registrarSolicitud(solicitud(sinFactura, { id: `SOL-C-${SUF}` })), (e) => e.status === 422 && /todavía no tiene factura emitida/.test(e.message));
  assert.equal((await query(`SELECT count(*)::int n FROM devoluciones.devoluciones WHERE solicitud_externa = ANY($1)`, [[`SOL-A-${SUF}`, `SOL-B-${SUF}`, `SOL-C-${SUF}`]])).rows[0].n, 0);
});

test("aplica las reglas normales: mas de lo comprado o fuera de plazo dan 422 y no se registra nada", async () => {
  const o = orden();
  await assert.rejects(registrarSolicitud(solicitud(o, { id: `SOL-D-${SUF}`, productos: [{ descripcion: "Producto A", cantidad: 6 }] })), (e) => e.status === 422);
  const vieja = orden({ fechaFactura: hace(10) });
  await assert.rejects(registrarSolicitud(solicitud(vieja, { id: `SOL-E-${SUF}` })), (e) => e.status === 422);
  await assert.rejects(registrarSolicitud(solicitud(o, { id: `SOL-F-${SUF}`, productos: [{ descripcion: "No esta en la factura", cantidad: 1 }] })), (e) => [400, 404, 422].includes(e.status));
});

test("Gestion de Pagos caida: 503 (error pasajero) y no se registra nada", async () => {
  const o = orden();
  const url = process.env.GESTION_PAGOS_URL;
  process.env.GESTION_PAGOS_URL = "http://localhost:1";
  try {
    await assert.rejects(registrarSolicitud(solicitud(o, { id: `SOL-G-${SUF}` })), (e) => e.status === 503);
  } finally {
    process.env.GESTION_PAGOS_URL = url;
  }
});
