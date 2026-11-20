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

// TDSI-139/143: ventas de cada dia (ultimos 30 dias del periodo) y la meta diaria.
export const obtenerVentasVsMeta = (periodo, token) => apiFetch(conPeriodo('/api/kpis/ventas-vs-meta', periodo), opciones(token), PAGOS)
