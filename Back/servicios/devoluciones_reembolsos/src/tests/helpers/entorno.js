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

  const servidor = app.listen(0);
  await new Promise((r) => servidor.once("listening", r));
  const base = `http://localhost:${servidor.address().port}`;

  async function llamar(metodo, ruta, cuerpo) {
    const r = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { status: r.status, cuerpo: await r.json() };
  }

  return {
    SUFIJO,
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
      await pool.end();
    },
  };
}

module.exports = { iniciarEntorno, facturaDe, hace };
