// TDSI-82: las consultas del listado, el historial y la exportacion solo las usa el Administrador (Bearer token validado
// contra Gestion de Caja). BD real; Caja "de mentira" solo para decidir quien es administrador; limpia lo que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const { esBandejaDeSupervisor } = require("../middlewares/requireAdministrador");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
let codigo;

test.before(async () => {
  entorno = await iniciarEntorno();
  const motivo = (await entorno.get("/api/devoluciones/motivos")).cuerpo.data[0].id;
  const numero = entorno.agregarFactura(200);
  codigo = (await entorno.post("/api/devoluciones", { factura_numero: numero, items: [{ descripcion: "Producto A", cantidad: 1 }], motivo_id: motivo, cajero: "cajero.admin@tallersis.test" })).cuerpo.data.codigo;
});
test.after(() => entorno.cerrar());

const pedir = (ruta, token) => fetch(`${entorno.base}${ruta}`, { headers: token === undefined ? {} : { Authorization: `Bearer ${token}` } });

const RUTAS_ADMIN = () => [
  "/api/devoluciones",
  "/api/devoluciones?estado=APROBADA",
  "/api/devoluciones?desde=2026-01-01&hasta=2026-12-31",
  "/api/devoluciones?cajero=algo",
  "/api/devoluciones?pagina=1",
  "/api/devoluciones?estado=PENDIENTE&pagina=1",
  "/api/devoluciones?estado=PENDIENTE&cajero=x",
  `/api/devoluciones/${codigo}/historial`,
  "/api/devoluciones/exportar",
];

test("sin token: 401 en el listado de control, el historial y la exportacion", async () => {
  for (const ruta of RUTAS_ADMIN()) {
    const r = await pedir(ruta);
    assert.equal(r.status, 401, ruta);
    assert.equal((await r.json()).mensaje, "Token de acceso requerido");
  }
});

test("token invalido o vencido: 401; token de un cajero que no es administrador: 403", async () => {
  for (const ruta of RUTAS_ADMIN()) {
    assert.equal((await pedir(ruta, "token-malo")).status, 401, ruta);
    const r = await pedir(ruta, "CAJERO-TEST");
    assert.equal(r.status, 403, ruta);
    assert.match((await r.json()).mensaje, /permisos de Administrador/);
  }
});

test("con el token del administrador: 200 en todas", async () => {
  for (const ruta of RUTAS_ADMIN()) {
    const r = await pedir(ruta, entorno.TOKEN_ADMIN);
    assert.equal(r.status, 200, ruta);
  }
  const nombre = await (await pedir(`/api/devoluciones/${codigo}/historial`, entorno.TOKEN_ADMIN)).json();
  assert.equal(nombre.data.codigo, codigo);
});

test("la bandeja del SUPERVISOR (?estado=PENDIENTE, con limite) sigue abierta sin token", async () => {
  for (const ruta of ["/api/devoluciones?estado=PENDIENTE", "/api/devoluciones?estado=pendiente&limite=50"]) {
    const r = await pedir(ruta);
    assert.equal(r.status, 200, ruta);
  }
  assert.equal(entorno.verificaciones.filter((t) => t === "").length, 0); // no se consulto a Caja para esas
});

test("el detalle de una devolucion y el resto de rutas del cajero NO exigen administrador", async () => {
  assert.equal((await pedir(`/api/devoluciones/${codigo}`)).status, 200);
  assert.equal((await pedir("/api/devoluciones/motivos")).status, 200);
  assert.equal((await pedir(`/api/devoluciones/${codigo}/reembolso`)).status, 409); // pendiente: no es de administrador, es de estado
});

test("Gestion de Caja caida: 503 y no se entrega la informacion", async () => {
  const url = process.env.ADMIN_VERIFICAR_URL;
  process.env.ADMIN_VERIFICAR_URL = "http://localhost:1";
  try {
    for (const ruta of ["/api/devoluciones", `/api/devoluciones/${codigo}/historial`, "/api/devoluciones/exportar"]) {
      assert.equal((await pedir(ruta, entorno.TOKEN_ADMIN)).status, 503, ruta);
    }
  } finally {
    process.env.ADMIN_VERIFICAR_URL = url;
  }
});

test("esBandejaDeSupervisor: solo PENDIENTE sin otros filtros (limite si)", () => {
  assert.equal(esBandejaDeSupervisor({ estado: "PENDIENTE" }), true);
  assert.equal(esBandejaDeSupervisor({ estado: " pendiente ", limite: "5" }), true);
  for (const q of [{}, { estado: "APROBADA" }, { estado: "PENDIENTE", desde: "2026-01-01" }, { estado: "PENDIENTE", hasta: "2026-01-01" }, { estado: "PENDIENTE", cajero: "x" }, { estado: "PENDIENTE", pagina: "1" }, { limite: "5" }]) {
    assert.equal(esBandejaDeSupervisor(q), false, JSON.stringify(q));
  }
});
