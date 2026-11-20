import { apiFetch } from './client.js'

// Microservicio Back/servicios/devoluciones_reembolsos (puerto 4007).
export const DEVOLUCIONES_API_BASE_URL = import.meta.env.VITE_DEVOLUCIONES_API_BASE_URL ?? 'http://localhost:4007'

const llamar = (path, options) => apiFetch(path, options, DEVOLUCIONES_API_BASE_URL)

// TDSI-12/13: busca una factura por su numero (F-000123) y devuelve sus productos con la cantidad que
// todavia se puede devolver, si esta dentro del plazo de 7 dias y por que no se puede devolver (bloqueo).
export function buscarFacturaParaDevolucion(numero) {
  return llamar(`/api/devoluciones/factura/${encodeURIComponent(numero)}`)
}
