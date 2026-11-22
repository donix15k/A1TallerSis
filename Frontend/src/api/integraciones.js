import { apiFetch } from './client.js'

// Monitor de integraciones (Back/servicios/gestion_pagos): solo administrador (Bearer token).
const GESTION_PAGOS_API_BASE_URL = import.meta.env.VITE_GESTION_PAGOS_API_BASE_URL ?? ''
const conToken = (token) => ({ headers: { Authorization: `Bearer ${token}` } })

function qs(filtros = {}) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== null && String(v).trim() !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

// TDSI-126/127/131: mensajes de todos los microservicios con filtros (grupo C/D/E, estado, desde, hasta) y paginacion.
// Cada mensaje: { origen, id, grupo, tipo, referencia, fecha, estado, message_id, intentos, error, puede_reenviar, detalle, datos }
export function listarMensajesIntegracion(filtros, token) {
  return apiFetch(`/api/integraciones/mensajes${qs(filtros)}`, conToken(token), GESTION_PAGOS_API_BASE_URL)
}

// TDSI-128/130: totales por grupo (Compras, Contabilidad, Marketplace) y por estado, y las tarjetas del Panel de KPIs.
export function obtenerResumenIntegraciones(token, { periodo } = {}) {
  return apiFetch(`/api/integraciones/resumen${qs({ periodo })}`, conToken(token), GESTION_PAGOS_API_BASE_URL)
}

// TDSI-129/132: reenvia un mensaje en Error a traves del microservicio dueno (misma idempotency_key).
// Un asiento RECHAZADO por Contabilidad se reenvia con una `justificacion` (como se resolvio): viaja dentro del mensaje.
export function reenviarMensajeIntegracion({ origen, id, justificacion }, token) {
  return apiFetch(
    `/api/integraciones/mensajes/${encodeURIComponent(origen)}/${encodeURIComponent(id)}/reenviar`,
    { method: 'POST', body: JSON.stringify({ justificacion }), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    GESTION_PAGOS_API_BASE_URL,
  )
}
