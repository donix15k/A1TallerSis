import { useEffect } from 'react'
import { refrescarSesion } from '../api/refrescarSesion.js'

const ANTICIPO_MS = 5 * 60 * 1000 // se renueva 5 minutos antes de que venza
const REINTENTO_MS = 30 * 1000

/**
 * Mantiene viva la sesión: unos minutos antes de que venza el access_token lo cambia por uno nuevo con el refresh_token, sin molestar al usuario.
 *   - Si el servidor dice que ya no se puede renovar (401: refresh_token vencido o usado), cierra la sesión.
 *   - Si falla por red, reintenta en 30 s (no cierra la sesión por un corte pasajero).
 * Las sesiones sin refresh_token (iniciadas antes de este cambio) siguen como siempre: duran lo que dure su token.
 */
export default function useRenovarSesion(sesion, actualizar, cerrar) {
  const refresh = sesion?.refresh_token
  const vence = sesion?.vence_en
  useEffect(() => {
    if (!refresh) return undefined
    let cancelado = false
    let timer
    async function renovar() {
      try {
        const r = await refrescarSesion(refresh)
        if (cancelado) return
        actualizar({
          access_token: r.data.access_token,
          refresh_token: r.data.refresh_token,
          vence_en: Date.now() + (r.data.expires_in ?? 3600) * 1000,
        })
      } catch (e) {
        if (cancelado) return
        if (e.status === 401 || e.status === 400) cerrar()
        else timer = setTimeout(renovar, REINTENTO_MS)
      }
    }
    timer = setTimeout(renovar, Math.max(0, (vence ?? Date.now()) - Date.now() - ANTICIPO_MS))
    return () => {
      cancelado = true
      clearTimeout(timer)
    }
    // actualizar y cerrar son estables en la práctica (cierran sobre setState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, vence])
}
