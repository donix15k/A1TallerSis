import { apiFetch } from './client.js'

// Panel de KPIs: cada KPI vive en el microservicio duenio de sus datos. Todos exigen el token del administrador.
const PAGOS = import.meta.env.VITE_GESTION_PAGOS_API_BASE_URL ?? ''
const CAJA = import.meta.env.VITE_GESTION_CAJA_API_BASE_URL ?? ''
const FACTURACION = import.meta.env.VITE_FACTURACION_API_BASE_URL ?? ''
const PROVEEDORES = import.meta.env.VITE_PAGOS_PROVEEDORES_API_BASE_URL ?? ''

const opciones = (token, extra = {}) => ({ ...extra, headers: { Authorization: `Bearer ${token}`, ...(extra.headers ?? {}) } })
const conPeriodo = (ruta, periodo, extra = '') => `${ruta}?periodo=${encodeURIComponent(periodo)}${extra}`

// TDSI-138/142: tarjetas del Resumen (ticket promedio, anulacion y devoluciones) con su color.
export const obtenerResumenKpis = (periodo, token) => apiFetch(conPeriodo('/api/kpis/resumen', periodo), opciones(token), PAGOS)

// TDSI-150/152: pestaña Riesgo: tasa de anulacion y tasa de devoluciones (con motivos) y su color.
export const obtenerRiesgo = (periodo, token) => apiFetch(conPeriodo('/api/kpis/riesgo', periodo), opciones(token), PAGOS)

// TDSI-151/153: anulaciones por cajero (de mayor a menor).
export const obtenerAnulacionesPorCajero = (periodo, token) => apiFetch(conPeriodo('/api/kpis/anulaciones/por-cajero', periodo), opciones(token), PAGOS)

// TDSI-159/162: cumplimiento de metas por caja (vendido, meta, % y color) y el % general (Gestion de Caja).
export const obtenerCumplimientoMetas = (periodo, token) => apiFetch(conPeriodo('/api/kpis/cumplimiento-metas', periodo), opciones(token), CAJA)

// TDSI-169/172: efectividad de cuadre (turnos que cuadran, sobrantes, faltantes, turnos con diferencia y ultimos turnos).
export const obtenerCuadreCaja = (periodo, token) => apiFetch(conPeriodo('/api/kpis/cuadre-caja', periodo, '&ultimos=6'), opciones(token), CAJA)

// TDSI-179/180/183: aceptacion contable (asientos enviados, registrados, rechazados y la lista de rechazados) (Facturacion).
export const obtenerAceptacionContable = (periodo, token) => apiFetch(conPeriodo('/api/kpis/aceptacion-contable', periodo, '&limite=50'), opciones(token), FACTURACION)

// TDSI-181/182/185: dias promedio de pago a proveedores, ordenes vencidas y pagadas (Pagos a Proveedores).
export const obtenerDiasPagoProveedores = (periodo, token) => apiFetch(conPeriodo('/api/kpis/dias-pago-proveedores', periodo, '&limite=20'), opciones(token), PROVEEDORES)

// TDSI-182/183: tarjetas de estado de Contabilidad, Compras / Proveedores y Marketplace (Monitor de integraciones).
export const obtenerTarjetasIntegraciones = (periodo, token) => apiFetch(conPeriodo('/api/integraciones/resumen', periodo), opciones(token), PAGOS)

// TDSI-192/195: "Alertas del dia": una linea por alerta, primero las ROJAS y luego las AMARILLAS.
export const obtenerAlertas = (periodo, token) => apiFetch(conPeriodo('/api/kpis/alertas', periodo), opciones(token), PAGOS)

// TDSI-200/203: limites Verde / Amarillo / Rojo de los 7 KPIs y la meta mensual de cada caja.
export const obtenerObjetivos = (token) => apiFetch('/api/kpis/objetivos', opciones(token), PAGOS)

// TDSI-201/205: guarda limites ({ indicadores: [{ indicador, verde, amarillo, rojo }] }) y metas ({ metas_cajas: [{ caja_id, monto_mensual }] }).
// 400 con detalle.errores = [{ campo: "tasa_anulacion.amarillo", mensaje }] si algo no es coherente (no guarda nada).
export const guardarObjetivos = (cuerpo, token) =>
  apiFetch('/api/kpis/objetivos', opciones(token, { method: 'PUT', body: JSON.stringify(cuerpo) }), PAGOS)

// TDSI-139/143: ventas de cada dia (ultimos 30 dias del periodo) y la meta diaria.
export const obtenerVentasVsMeta = (periodo, token) => apiFetch(conPeriodo('/api/kpis/ventas-vs-meta', periodo), opciones(token), PAGOS)
