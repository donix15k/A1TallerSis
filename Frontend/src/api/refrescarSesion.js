import { apiFetch } from './client.js'

// Renueva la sesión (cajero o administrador) con el refresh_token de Supabase: el access_token dura 1 hora y así no hay que volver a escribir la contraseña.
const GESTION_CAJA_API_BASE_URL = import.meta.env.VITE_GESTION_CAJA_API_BASE_URL ?? ''

export function refrescarSesion(refresh_token) {
  return apiFetch('/api/auth/refrescar', { method: 'POST', body: JSON.stringify({ refresh_token }) }, GESTION_CAJA_API_BASE_URL)
}
