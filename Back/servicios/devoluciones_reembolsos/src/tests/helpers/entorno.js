// Entorno de pruebas compartido por los tests de rutas:
//  - la app de devoluciones levantada en un puerto libre, con la base de devoluciones REAL (Supabase);
//  - un Facturacion "de mentira" (servidor HTTP local) SOLO para controlar que facturas existen y que PIN
//    de supervisor es valido: las facturas reales ya tienen mas de 7 dias y probar PIN incorrectos contra
//    supervisores reales los bloquearia. NUNCA se crean facturas con POST /api/facturas (publica a Contabilidad).
const http = require("http");
const { query, pool } = require("../../config/db");
const app = require("../../app");

const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

function facturaDe(numero, { fecha = hace(1), estado = "Emitida", items, metodosPago, canal = "Presencial" } = {}) {
  return {
    numero,
    fecha,
    cliente_nit: "1234567",
    cliente_nombre: "Cliente de prueba",
    estado,
    canal,
    total: "100.00",
    items: items ?? [
      { descripcion: "Producto A", cantidad: "5.00", precio_unitario: "10.00", subtotal: "50.00" },
      { descripcion: "Producto B", cantidad: "2.00", precio_unitario: "25.00", subtotal: "50.00" },
    ],
    metodosPago: metodosPago ?? [{ metodo: "Efectivo", monto: "100.00" }],
  };
}

async function iniciarEntorno() {
  const SUFIJO = Date.now();
  const facturas = new Map(); // numero -> factura que "tiene" Facturacion
  // id -> { pin, nombre, bloqueado }; cualquier otro usuario o PIN -> 401
  const supervisores = new Map([["SUP-OK", { pin: "1234", nombre: "Supervisor de prueba" }]]);
  const intentosValidar = []; // lo que recibio POST /api/supervisores/validar

  const facturacion = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST" && req.url === "/api/supervisores/validar") {
      let cuerpo = "";
      req.on("data", (c) => (cuerpo += c));
      req.on("end", () => {
        const { supervisor_id, pin } = JSON.parse(cuerpo || "{}");
        intentosValidar.push({ supervisor_id, pin });
        const sup = supervisores.get(supervisor_id);
        if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, mensaje: "El PIN debe tener entre 4 y 6 dígitos", detalle: null }));
        }
        if (sup?.bloqueado) {
          res.statusCode = 423;
          return res.end(JSON.stringify({ ok: false, mensaje: "Supervisor bloqueado por intentos fallidos. Intente en 15 minuto(s)", detalle: { bloqueado_hasta: "2099-01-01T00:00:00Z" } }));
        }
        if (!sup || sup.pin !== pin) {
          res.statusCode = 401;
          return res.end(JSON.stringify({ ok: false, mensaje: "Supervisor o PIN incorrecto", detalle: { intentos_restantes: 2 } }));
        }
        res.end(JSON.stringify({ ok: true, data: { supervisor_id, nombre: sup.nombre } }));
      });
      return;
    }
    const numero = decodeURIComponent(req.url.split("/").pop());
    if (!facturas.has(numero)) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ ok: false, mensaje: "Factura no encontrada" }));
    }
    res.end(JSON.stringify({ ok: true, data: facturas.get(numero) }));
  });
  await new Promise((r) => facturacion.listen(0, r));
  process.env.FACTURACION_URL = `http://localhost:${facturacion.address().port}`;

  // TDSI-82: Gestion de Caja "de mentira" SOLO para decidir si un token es de administrador (las consultas del
  // administrador exigen Bearer). Los tests mandan TOKEN_ADMIN por defecto; los otros tokens dan 401 / 403.
  // TDSI-92: Pub/Sub FALSO. Las pruebas NUNCA publican de verdad al topico de Contabilidad (Grupo D) aunque el .env tenga
  // credenciales: todo lo que se "publica" queda en pubsub.publicados; con pubsub.falla = Error, la publicacion falla.
  const pubsub = { publicados: [], falla: null };
  require("../../clients/pubsubPublisher").usarClienteDePrueba({
    topic: () => ({
      publishMessage: async (m) => {
        if (pubsub.falla) throw pubsub.falla;
        pubsub.publicados.push(m);
        return `fake-msg-${pubsub.publicados.length}`;
      },
      iam: { testPermissions: async () => [{ "pubsub.topics.publish": true }] },
    }),
  });

  const TOKEN_ADMIN = "ADMIN-TEST";
  const verificaciones = [];
  const caja = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    verificaciones.push(token);
    if (req.url !== "/api/administradores/verificar") { res.statusCode = 404; return res.end("{}"); }
    if (token === TOKEN_ADMIN) return res.end(JSON.stringify({ ok: true, data: { administrador_id: "ADM-1", nombre: "Admin de prueba" } }));
    if (token === "CAJERO-TEST") { res.statusCode = 403; return res.end(JSON.stringify({ ok: false, mensaje: "Esta accion requiere permisos de Administrador." })); }
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, mensaje: "Token invalido o vencido" }));
  });
  await new Promise((r) => caja.listen(0, r));
  process.env.ADMIN_VERIFICAR_URL = `http://localhost:${caja.address().port}`;

  const servidor = app.listen(0);
  await new Promise((r) => servidor.once("listening", r));
  const base = `http://localhost:${servidor.address().port}`;

  async function llamar(metodo, ruta, cuerpo) {
    const r = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN_ADMIN}` },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { status: r.status, cuerpo: await r.json() };
  }

  return {
    SUFIJO,
    pubsub,
    TOKEN_ADMIN,
    verificaciones,
    /** Cabecera con el token de administrador de prueba (para los fetch directos que no usan get/post). */
    cabeceraAdmin: { Authorization: `Bearer ${TOKEN_ADMIN}` },
    base,
    facturas,
    supervisores,
    intentosValidar,
    get: (ruta) => llamar("GET", ruta),
    post: (ruta, cuerpo) => llamar("POST", ruta, cuerpo),
    /** Numero de factura de prueba (nunca choca con los reales). */
    numero: (n) => `F-T${SUFIJO}${n}`.slice(0, 20),
    /** Registra en el Facturacion simulado una factura reciente (o la que se indique). */
    agregarFactura(n, opciones) {
      const numero = `F-T${SUFIJO}${n}`.slice(0, 20);
      facturas.set(numero, facturaDe(numero, opciones));
      return numero;
    },
    /** Borra TODO lo que dejaron las pruebas en la base real. */
    async limpiar() {
      await query(`DELETE FROM devoluciones.devoluciones WHERE factura_numero LIKE $1`, [`F-T${SUFIJO}%`]);
    },
    async cerrar() {
      await query(`DELETE FROM devoluciones.devoluciones WHERE factura_numero LIKE $1`, [`F-T${SUFIJO}%`]);
      servidor.closeAllConnections();
      facturacion.closeAllConnections();
      await new Promise((r) => servidor.close(r));
      await new Promise((r) => facturacion.close(r));
      require("../../clients/pubsubPublisher").usarClienteDePrueba(null);
      caja.closeAllConnections();
      await new Promise((r) => caja.close(r));
      await pool.end();
    },
  };
}

module.exports = { iniciarEntorno, facturaDe, hace };
