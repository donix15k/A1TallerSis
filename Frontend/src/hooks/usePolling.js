import { useEffect, useRef } from 'react'

/** Llama a `funcion` cada `ms` milisegundos mientras `activo` y la pestaña esté visible (no consulta de más en segundo plano). */
export default function usePolling(funcion, ms, activo = true) {
  const ref = useRef(funcion)
  ref.current = funcion
  useEffect(() => {
    if (!activo) return undefined
    const id = setInterval(() => {
      if (!document.hidden) ref.current()
    }, ms)
    return () => clearInterval(id)
  }, [ms, activo])
}
