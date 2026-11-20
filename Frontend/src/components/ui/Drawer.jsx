import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import Icono from './Icono.jsx'

/** Panel lateral derecho (curva tipo iOS). Escape o clic fuera lo cierran. */
function Drawer({ abierto, onCerrar, titulo, subtitulo, acciones, children }) {
  useEffect(() => {
    if (!abierto) return undefined
    const alTeclear = (e) => e.key === 'Escape' && onCerrar?.()
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [abierto, onCerrar])

  if (!abierto) return null
  return createPortal(
    <>
      <div className="vxp-drawer-fondo" onClick={onCerrar} />
      <aside className="vxp-drawer" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="vxp-drawer-cabecera">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{titulo}</h2>
            {subtitulo && <div style={{ marginTop: 4, fontSize: '0.84rem', color: 'rgba(223,232,245,.85)' }}>{subtitulo}</div>}
          </div>
          {acciones}
          <button type="button" className="vxp-icono-btn" style={{ color: '#fff' }} onClick={onCerrar} aria-label="Cerrar">
            <Icono nombre="x" tam={18} />
          </button>
        </div>
        <div className="vxp-drawer-cuerpo">{children}</div>
      </aside>
    </>,
    document.body,
  )
}

export default Drawer
