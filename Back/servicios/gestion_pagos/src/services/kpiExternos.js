// TDSI-182/192: los KPIs que calculan OTROS microservicios (Caja, Facturacion, Pagos a Proveedores) se piden por HTTP (nunca SQL cruzado),
// reenviando el token del administrador. Si un servicio no responde NO se cae el Panel: devuelve { datos: null, error } y el panel
// muestra ese indicador sin datos.
const urlCaja = () => process.env.GESTION_CAJA_URL || "http://localhost:4004";
const urlFacturacion = () => process.env.FACTURACION_URL || "http://localhost:4002";
const urlProveedores = () => process.env.PAGOS_PROVEEDORES_URL || "http://localhost:4006";
const timeoutMs = () => Number(process.env.INTEGRACIONES_TIMEOUT_MS) || 5000;

async function pedirKpi(url, { token, nombre }) {
  try {
    const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(timeoutMs()) });
    const cuerpo = await r.json().catch(() => null);
    if (r.status !== 200 || !cuerpo?.data) return { datos: null, error: cuerpo?.mensaje || `${nombre} respondió HTTP ${r.status}` };
    return { datos: cuerpo.data, error: null };
  } catch (e) {
    const lenta = e.name === "TimeoutError" || e.name === "AbortError";
    return { datos: null, error: lenta ? `${nombre} no respondió a tiempo` : `No se pudo conectar con ${nombre}` };
  }
}

const q = (periodo) => encodeURIComponent(periodo);

/** KPI 4 · cumplimiento de metas por caja (Gestion de Caja). */
const cumplimientoMetas = ({ periodo, token }) => pedirKpi(`${urlCaja()}/api/kpis/cumplimiento-metas?periodo=${q(periodo)}`, { token, nombre: "Gestión de Caja" });
/** KPI 5 · efectividad de cuadre (Gestion de Caja). Solo hace falta el resumen: 1 ultimo turno. */
const cuadreCaja = ({ periodo, token, ultimos = 1 }) => pedirKpi(`${urlCaja()}/api/kpis/cuadre-caja?periodo=${q(periodo)}&ultimos=${ultimos}`, { token, nombre: "Gestión de Caja" });
/** KPI 6 · aceptacion contable (Facturacion). */
const aceptacionContable = ({ periodo, token, limite = 1 }) => pedirKpi(`${urlFacturacion()}/api/kpis/aceptacion-contable?periodo=${q(periodo)}&limite=${limite}`, { token, nombre: "Facturación" });
/** KPI 7 · dias de pago a proveedores (Pagos a Proveedores). */
const diasPagoProveedores = ({ periodo, token, limite = 1 }) => pedirKpi(`${urlProveedores()}/api/kpis/dias-pago-proveedores?periodo=${q(periodo)}&limite=${limite}`, { token, nombre: "Pagos a Proveedores" });

module.exports = { pedirKpi, cumplimientoMetas, cuadreCaja, aceptacionContable, diasPagoProveedores };
