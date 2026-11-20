import { apiFetch } from './client.js'

// Pantalla "Mi turno" del cajero (Back/servicios/gestion_caja). Usa el token del cajero que inicio sesion: el servidor busca
// SIEMPRE el turno con esa identidad, asi un cajero nunca ve los datos de otro.
const CAJA = import.meta.env.VITE_GESTION_CAJA_API_BASE_URL ?? ''
const conToken = (token, extra = {}) => ({ ...extra, headers: { Authorization: `Bearer ${token}` } })

// TDSI-220/221/224: numeros del turno abierto (ventas, ticket promedio, anulaciones), meta de hoy de la caja y efectivo esperado.
// Sin turno abierto responde { turno: null, mensaje: "Abra su turno para ver sus indicadores" }.
export function obtenerMiTurno(token, cajaId) {
  return apiFetch(`/api/kpis/mi-turno${cajaId ? `?caja_id=${encodeURIComponent(cajaId)}` : ''}`, conToken(token), CAJA)
}

// TDSI-222/225: diferencia del cierre (efectivo contado vs esperado) y su estado CUADRA, SOBRA o FALTA. No cierra el turno.
export function compararMiCierre(token, { efectivo_contado, caja_id }) {
  return apiFetch('/api/kpis/mi-turno/cierre', conToken(token, { method: 'POST', body: JSON.stringify({ efectivo_contado, caja_id }) }), CAJA)
}
