// TDSI-126/129: de donde sale cada mensaje del Monitor de integraciones. Cada FUENTE sabe leer los envios de un microservicio
// (por HTTP, nunca por SQL cruzado; los de Gestion de Pagos se leen de su propia base) y reenviar el que quedo en Error,
// devolviendo siempre el formato comun:
//   { origen, id, grupo (C, D, E), tipo, referencia, fecha, estado (Enviado | Respondido | Pendiente | Error), message_id,
//     intentos, error, puede_reenviar, detalle, datos }
const { query } = require("../../config/db");
const { AppError } = require("../../utils/AppError");
const { enviarACompras } = require("../productosVendidosService");
const { reenviarAvisoMarketplace } = require("../avisoMarketplaceService");

const timeoutMs = () => Number(process.env.INTEGRACIONES_TIMEOUT_MS) || 5000;
const ESTADOS = ["Enviado", "Respondido", "Pendiente", "Error"];

/** Pasa el estado propio de cada servicio (Pendiente/ENVIADO/Recibido/registrado...) a los 4 estados del monitor. */
function normalizarEstado(texto, { respondido = false } = {}) {
  if (respondido) return "Respondido";
  const t = String(texto ?? "").trim().toLowerCase();
  if (["recibido", "respondido", "registrado", "rechazado", "aceptado"].includes(t)) return "Respondido";
  if (t.startsWith("error") || t === "fallido") return "Error";
  if (t.startsWith("pendiente")) return "Pendiente";
  if (t.startsWith("enviad")) return "Enviado";
  return ESTADOS.find((e) => e.toLowerCase() === t) || "Pendiente";
}

function mensaje({ origen, id, grupo, tipo, referencia, fecha, estado, message_id = null, intentos = null, error = null, detalle = {}, datos = null }) {
  return { origen, id: String(id), grupo, tipo, referencia: referencia ?? null, fecha: fecha ?? null, estado, message_id: message_id || null, intentos, error: error || null, puede_reenviar: estado === "Error" || String(detalle?.resultado ?? "").toLowerCase() === "rechazado", detalle, datos };
}

async function http(url, { metodo = "GET", token = null, cuerpo = null } = {}) {
  let r;
  try {
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cuerpo ? { "Content-Type": "application/json" } : {}) };
    r = await fetch(url, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(timeoutMs()) });
  } catch (e) {
    const lenta = e.name === "TimeoutError" || e.name === "AbortError";
    throw new AppError(lenta ? "no respondió a tiempo" : "no se pudo conectar", 503, { causa: e.message });
  }
  return { status: r.status, cuerpo: await r.json().catch(() => null) };
}

/** El servicio dueño responde con su propio estado HTTP; lo que no es 2xx se informa con su mensaje. */
function exigir(r, que) {
  if (r.status >= 200 && r.status < 300 && r.cuerpo) return r.cuerpo;
  throw new AppError(r.cuerpo?.mensaje || `${que} respondió HTTP ${r.status}`, r.status >= 400 && r.status < 500 ? r.status : 502, r.cuerpo?.detalle ?? null);
}

const urlFacturacion = () => process.env.FACTURACION_URL || "http://localhost:4002";
const urlCaja = () => process.env.GESTION_CAJA_URL || "http://localhost:4004";
const urlProveedores = () => process.env.PAGOS_PROVEEDORES_URL || "http://localhost:4006";
const urlDevoluciones = () => process.env.DEVOLUCIONES_URL || "http://localhost:4007";

const FUENTES = [
  {
    origen: "facturacion",
    // Facturas y anulaciones que se avisan a Contabilidad (Grupo D)
    async listar() {
      const c = exigir(await http(`${urlFacturacion()}/api/facturas/envios-contabilidad?limite=200`), "Facturación");
      return (c.data?.envios || []).map((e) =>
        mensaje({
          origen: "facturacion", id: e.id, grupo: "D", tipo: e.tipo === "anulacion" ? "FACTURA_ANULACION" : "FACTURA_VENTA",
          referencia: e.tipo === "anulacion" ? `ANU-${e.factura_numero}` : e.factura_numero, fecha: e.enviado_en || e.creado_en,
          estado: normalizarEstado(e.estado, { respondido: Boolean(e.resultado) }), message_id: e.pubsub_message_id, intentos: e.intentos, error: e.ultimo_error,
          detalle: { resultado: e.resultado ?? null, numero_asiento: e.numero_asiento ?? null, motivo: e.resultado_motivo ?? null },
        })
      );
    },
    async reenviar(id, { justificacion } = {}) {
      exigir(await http(`${urlFacturacion()}/api/facturas/envios-contabilidad/${encodeURIComponent(id)}/reenviar`, { metodo: "POST", cuerpo: { justificacion } }), "Facturación");
    },
  },
  {
    origen: "gestion_caja",
    // Diferencias de caja resueltas que se avisan a Contabilidad (Grupo D)
    async listar() {
      const c = exigir(await http(`${urlCaja()}/api/caja/diferencias`), "Gestión de Caja");
      return (c.data || [])
        .filter((d) => d.contabilidad)
        .map((d) =>
          mensaje({
            origen: "gestion_caja", id: d.id, grupo: "D", tipo: "DIFERENCIA_CAJA", referencia: `DIF-${d.id}`, fecha: d.resuelta_en,
            estado: normalizarEstado(d.contabilidad.estado), intentos: d.contabilidad.intentos, error: d.contabilidad.ultimo_error,
            detalle: { turno_id: d.turno_id, monto: d.monto, motivo_rechazo: d.contabilidad.motivo_rechazo ?? null },
          })
        );
    },
    async reenviar(id, { justificacion } = {}) {
      exigir(await http(`${urlCaja()}/api/caja/diferencias/${encodeURIComponent(id)}/reenviar-contabilidad`, { metodo: "POST", cuerpo: { justificacion } }), "Gestión de Caja");
    },
  },
  {
    origen: "pagos_proveedores",
    // Lotes de cierre diario que se avisan a Contabilidad (Grupo D)
    async listar() {
      const c = exigir(await http(`${urlProveedores()}/api/envios-contabilidad?limite=200`), "Pagos a Proveedores");
      return (c.data?.envios || []).map((e) =>
        mensaje({
          origen: "pagos_proveedores", id: e.id, grupo: "D", tipo: "LOTE_CIERRE", referencia: `LOTE-${e.lote_id}`, fecha: e.enviado_en || e.creado_en || e.fecha,
          estado: normalizarEstado(e.estado, { respondido: Boolean(e.referencia_contabilidad) }), message_id: e.pubsub_message_id, intentos: e.intentos, error: e.ultimo_error,
          detalle: { fecha_lote: e.fecha ?? null, referencia_contabilidad: e.referencia_contabilidad ?? null },
        })
      );
    },
    async reenviar(id) {
      exigir(await http(`${urlProveedores()}/api/envios-contabilidad/${encodeURIComponent(id)}/reenviar`, { metodo: "POST" }), "Pagos a Proveedores");
    },
  },
  {
    origen: "devoluciones",
    // Notas de credito (D), productos devueltos (C) y resultado de devoluciones del Marketplace (E): ya vienen en formato comun
    async listar({ token }) {
      const c = exigir(await http(`${urlDevoluciones()}/api/integraciones/mensajes`, { token }), "Devoluciones");
      return (c.data || []).map((m) => mensaje({ ...m, origen: "devoluciones" }));
    },
    async reenviar(id, { token, justificacion }) {
      exigir(await http(`${urlDevoluciones()}/api/integraciones/mensajes/${encodeURIComponent(id)}/reenviar`, { metodo: "POST", token, cuerpo: { justificacion } }), "Devoluciones");
    },
  },
  {
    origen: "gestion_pagos_compras",
    // Reporte diario de productos vendidos que se avisa a Compras (Grupo C): base propia
    async listar() {
      const { rows } = await query(
        `SELECT id, fecha::text AS fecha, reporte_id, estado, intentos, pubsub_message_id, ultimo_error, COALESCE(enviado_en, creado_en) AS cuando, recibido_en, payload
           FROM pagos.envios_compras ORDER BY fecha DESC LIMIT 200`
      );
      return rows.map((e) =>
        mensaje({
          origen: "gestion_pagos_compras", id: e.id, grupo: "C", tipo: "PRODUCTOS_VENDIDOS", referencia: e.reporte_id, fecha: e.cuando,
          estado: normalizarEstado(e.estado), message_id: e.pubsub_message_id, intentos: e.intentos, error: e.ultimo_error,
          detalle: { fecha_reporte: e.fecha, recibido_en: e.recibido_en }, datos: e.payload,
        })
      );
    },
    async reenviar(id) {
      const { rows } = await query(`SELECT fecha::text AS fecha FROM pagos.envios_compras WHERE id = $1`, [id]);
      if (!rows[0]) throw new AppError(`No existe el envío ${id} a Compras.`, 404);
      await enviarACompras(rows[0].fecha); // 409 si ya no esta en Error; mismo reporte_id (PV-fecha): Compras no recibe duplicados
    },
  },
  {
    origen: "gestion_pagos_marketplace",
    // Aviso de factura emitida de una venta online al Marketplace (Grupo E): base propia
    async listar() {
      const { rows } = await query(
        `SELECT id, orden_id, numero_factura, aviso_marketplace_estado AS estado, aviso_marketplace_error AS error, recibida_en
           FROM pagos.ventas_online WHERE aviso_marketplace_estado IS NOT NULL ORDER BY recibida_en DESC LIMIT 200`
      );
      return rows.map((v) =>
        mensaje({
          origen: "gestion_pagos_marketplace", id: v.id, grupo: "E", tipo: "FACTURA_EMITIDA", referencia: v.orden_id, fecha: v.recibida_en,
          estado: normalizarEstado(v.estado), error: v.error, detalle: { numero_factura: v.numero_factura },
        })
      );
    },
    async reenviar(id) {
      await reenviarAvisoMarketplace(id);
    },
  },
];

let fuentesDePrueba = null;
/** Solo para pruebas: reemplaza las fuentes (null vuelve a las reales). */
function usarFuentesDePrueba(f) {
  fuentesDePrueba = f;
}
const fuentes = () => fuentesDePrueba || FUENTES;

module.exports = { fuentes, usarFuentesDePrueba, normalizarEstado, mensaje, ESTADOS };
