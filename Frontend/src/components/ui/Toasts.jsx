import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icono from './Icono.jsx'

const ToastContext = createContext(null)
const ICONO = { ok: 'checkCirculo', bad: 'xCirculo', warn: 'alerta', info: 'info' }
const DURACION_MS = 4200
const SALIDA_MS = 220

/**
 * Notificaciones flotantes (abajo a la derecha). Entran con una transicion (no keyframes) para que varias
 * seguidas se acomoden sin saltos. El temporizador se pausa con la pestana oculta y al pasar el puntero.
 *   const toast = useToast(); toast.ok('Devolución aprobada', 'DEV-0004 salió de la bandeja')
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const cerrar = useCallback((id) => {
    setToasts((lista) => lista.map((t) => (t.id === id ? { ...t, saliendo: true } : t)))
    setTimeout(() => setToasts((lista) => lista.filter((t) => t.id !== id)), SALIDA_MS)
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
  }, [])

  const programar = useCallback(
    (id, ms = DURACION_MS) => {
      clearTimeout(timers.current.get(id))
      timers.current.set(id, setTimeout(() => cerrar(id), ms))
    },
    [cerrar],
  )

  const mostrar = useCallback(
    (tono, titulo, detalle) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      setToasts((lista) => [...lista.slice(-3), { id, tono, titulo, detalle }])
      programar(id)
      return id
    },
    [programar],
  )

  useEffect(() => {
    function alCambiarVisibilidad() {
      if (document.hidden) timers.current.forEach((t) => clearTimeout(t))
      else toasts.forEach((t) => !t.saliendo && programar(t.id))
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    return () => document.removeEventListener('visibilitychange', alCambiarVisibilidad)
  }, [toasts, programar])

  const api = useRef(null)
  api.current = {
    ok: (t, d) => mostrar('ok', t, d),
    error: (t, d) => mostrar('bad', t, d),
    aviso: (t, d) => mostrar('warn', t, d),
    info: (t, d) => mostrar('info', t, d),
  }
  const [estable] = useState(() => ({
    ok: (...a) => api.current.ok(...a),
    error: (...a) => api.current.error(...a),
    aviso: (...a) => api.current.aviso(...a),
    info: (...a) => api.current.info(...a),
  }))

  return (
    <ToastContext.Provider value={estable}>
      {children}
      {createPortal(
        <div className="vxp-toasts" role="region" aria-label="Notificaciones" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`vxp-toast vxp-toast--${t.tono}${t.saliendo ? ' vxp-toast--saliendo' : ''}`}
              onMouseEnter={() => clearTimeout(timers.current.get(t.id))}
              onMouseLeave={() => programar(t.id, 1800)}
            >
              <span className="vxp-toast-icono">
                <Icono nombre={ICONO[t.tono]} tam={16} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{t.titulo}</strong>
                {t.detalle && <span>{t.detalle}</span>}
              </div>
              <button type="button" className="vxp-icono-btn" style={{ color: 'rgba(255,255,255,.6)', width: 26, height: 26 }} onClick={() => cerrar(t.id)} aria-label="Cerrar notificación">
                <Icono nombre="x" tam={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}
