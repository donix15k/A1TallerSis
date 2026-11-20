import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icono from './Icono.jsx'

/**
 * Modal premium: fondo oscurecido con desenfoque, entra subiendo y escalando desde 0.96 (centrado, no
 * desde un disparador). Escape y clic en el fondo cierran (salvo `bloqueado`, p. ej. mientras se envia).
 * Al abrir enfoca el primer campo; al cerrar devuelve el foco a donde estaba.
 */
function Modal({ abierto, onCerrar, titulo, subtitulo, icono, tono, ancho = 520, pie, bloqueado = false, children }) {
  const cajaRef = useRef(null)
  const previoRef = useRef(null)

  useEffect(() => {
    if (!abierto) return undefined
    previoRef.current = document.activeElement
    const enfocable = cajaRef.current?.querySelector('input:not([type=hidden]), select, textarea, button:not(.vxp-modal-cerrar)')
    enfocable?.focus()

    function alTeclear(e) {
      if (e.key === 'Escape' && !bloqueado) onCerrar?.()
    }
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('keydown', alTeclear)
      previoRef.current?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  if (!abierto) return null

  return createPortal(
    <div
      className="vxp-modal-fondo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !bloqueado) onCerrar?.()
      }}
    >
      <div className="vxp-modal" role="dialog" aria-modal="true" aria-label={titulo} ref={cajaRef} style={{ '--m-ancho': `${ancho}px` }}>
        <div className="vxp-modal-cabecera">
          {icono && (
            <span className={`vxp-modal-icono${tono ? ` vxp-modal-icono--${tono}` : ''}`}>
              <Icono nombre={icono} tam={20} />
            </span>
          )}
          <div>
            <h2>{titulo}</h2>
            {subtitulo && <p>{subtitulo}</p>}
          </div>
          <button type="button" className="vxp-icono-btn vxp-modal-cerrar" onClick={onCerrar} disabled={bloqueado} aria-label="Cerrar">
            <Icono nombre="x" tam={18} />
          </button>
        </div>
        <div className="vxp-modal-cuerpo">{children}</div>
        {pie && <div className="vxp-modal-pie">{pie}</div>}
      </div>
    </div>,
    document.body,
  )
}

export default Modal
