import { createContext, useContext, useEffect, useState } from 'react'
import useRenovarSesion from '../hooks/useRenovarSesion.js'

const AuthContext = createContext(null)
const STORAGE_KEY = 'tallersis_sesion_cajero'

// Sesion del cajero autenticado en el terminal POS.
// Se guarda en sessionStorage (no localStorage): al cerrar el navegador del
// terminal, la sesion se pierde, igual que un cierre de caja fisico.
export function AuthProvider({ children }) {
  const [cajero, setCajero] = useState(() => {
    try {
      const guardado = sessionStorage.getItem(STORAGE_KEY)
      return guardado ? JSON.parse(guardado) : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    try {
      if (cajero) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cajero))
      } else {
        sessionStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // sessionStorage no disponible (modo privado, etc.): la sesion no persiste al recargar.
    }
  }, [cajero])

  function iniciarSesion(datosCajero) {
    // vence_en: cuándo caduca el access_token (Supabase lo emite por 1 hora); sirve para renovarlo antes
    setCajero({ ...datosCajero, vence_en: Date.now() + (datosCajero.expires_in ?? 3600) * 1000 })
  }

  function cerrarSesion() {
    setCajero(null)
  }

  // renueva el token solo, antes de que venza (Mi turno y el resto lo usan)
  useRenovarSesion(cajero, (nuevo) => setCajero((c) => (c ? { ...c, ...nuevo } : c)), cerrarSesion)

  return (
    <AuthContext.Provider value={{ cajero, iniciarSesion, cerrarSesion }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const contexto = useContext(AuthContext)
  if (!contexto) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  }
  return contexto
}
