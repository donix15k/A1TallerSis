import { useCallback, useEffect, useRef, useState } from 'react'
import { obtenerComprobante, urlFacturaPdf } from '../api/pagos.js'
import Isotipo from './Isotipo.jsx'
import ReciboTermico from './ReciboTermico.jsx'
import './VistaFactura.css'

const menosMovimiento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Cuanto tarda en "imprimirse": proporcional al largo del recibo, con tope de 3 s (el cajero
// lo ve en cada venta; ademas se puede saltar con un clic o Espacio).
function duracionImpresion(altoPx) {
  return Math.min(3000, Math.round(1200 + altoPx * 2.1))
}

// El papel avanza a tirones cortos (como una impresora termica), no de corrido.
function cuadrosDeAvance(altoPx) {
  const pasos = Math.max(5, Math.round(altoPx / 110))
  return Array.from({ length: pasos + 1 }, (_, i) => ({
    offset: i / pasos,
    transform: `translateY(-${((1 - i / pasos) * 100).toFixed(3)}%)`,
    easing: 'cubic-bezier(0.45, 0, 0.3, 1)',
  }))
}

const TEXTO_ESTADO = {
  cargando: 'Preparando tu comprobante…',
  imprimiendo: 'Imprimiendo tu comprobante…',
  listo: 'Comprobante listo',
}

function IconoEstado({ estado }) {
  if (estado === 'listo') {
    return (
      <svg className="vx-imp-estado-icono vx-imp-estado-icono--ok" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="currentColor" />
        <path d="M7 12.5l3.2 3.2L17 8.8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (estado === 'error') {
    return (
      <svg className="vx-imp-estado-icono vx-imp-estado-icono--error" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="currentColor" />
        <path d="M8 8l8 8M16 8l-8 8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg className="vx-imp-estado-icono vx-imp-spinner" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="42 100" />
    </svg>
  )
}

// Vista previa de la factura: una "impresora" con el resumen de la venta y el recibo saliendo
// despacio por la ranura. El recibo es el mismo del PDF; si es largo, el area de abajo se
// desplaza para verlo completo (con su QR). Un clic sobre el papel o Espacio lo termina de sacar.
function VistaFactura({ idTransaccion, onCerrar }) {
  const [comprobante, setComprobante] = useState(null)
  const [estado, setEstado] = useState('cargando') // cargando | imprimiendo | listo | error
  const [error, setError] = useState(null)
  const papelRef = useRef(null)
  const animacionRef = useRef(null)
  const botonCerrarRef = useRef(null)

  const cargar = useCallback(() => {
    setEstado('cargando')
    setError(null)
    obtenerComprobante(idTransaccion)
      .then((respuesta) => {
        setComprobante(respuesta.data)
        setEstado('imprimiendo')
      })
      .catch((err) => {
        setError(err.message)
        setEstado('error')
      })
  }, [idTransaccion])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Salida del papel (Web Animations: se puede saltar con finish()).
  useEffect(() => {
    if (estado !== 'imprimiendo' || !papelRef.current) return undefined
    if (menosMovimiento()) {
      setEstado('listo')
      return undefined
    }
    const papel = papelRef.current
    const alto = papel.offsetHeight
    const animacion = papel.animate(cuadrosDeAvance(alto), {
      duration: duracionImpresion(alto),
      easing: 'linear',
      fill: 'forwards',
    })
    animacionRef.current = animacion
    animacion.finished.then(() => setEstado('listo')).catch(() => {})
    return () => animacion.cancel()
  }, [estado])

  const saltar = useCallback(() => {
    if (animacionRef.current && estado === 'imprimiendo') animacionRef.current.finish()
  }, [estado])

  // Escape cierra, Espacio termina de imprimir; el fondo no se desplaza mientras esta abierta.
  useEffect(() => {
    function alTeclear(e) {
      if (e.key === 'Escape') onCerrar()
      if (e.key === ' ' && estado === 'imprimiendo') {
        e.preventDefault()
        saltar()
      }
    }
    document.addEventListener('keydown', alTeclear)
    const overflowPrevio = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    botonCerrarRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', alTeclear)
      document.body.style.overflow = overflowPrevio
    }
  }, [onCerrar, estado, saltar])

  const modelo = comprobante?.modelo
  const textoEstado = estado === 'error' ? error || 'No se pudo cargar el comprobante.' : TEXTO_ESTADO[estado]

  return (
    <div
      className="vx-imp-fondo"
      role="dialog"
      aria-modal="true"
      aria-label={`Comprobante ${idTransaccion}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar()
      }}
    >
      <div className="vx-imp">
        <div className={`vx-imp-maquina${estado === 'imprimiendo' ? ' vx-imp-maquina--trabajando' : ''}`}>
          <div className="vx-imp-cabecera">
            <span className="vx-imp-logo">
              <Isotipo />
            </span>
            <button type="button" className="vx-imp-cerrar" onClick={onCerrar} ref={botonCerrarRef}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              Cerrar
            </button>
          </div>

          <div className="vx-imp-resumen">
            <div className="vx-imp-resumen-fila">
              <div>
                <p className="vx-imp-resumen-titulo">{modelo ? modelo.titulo.charAt(0) + modelo.titulo.slice(1).toLowerCase() : 'Comprobante'}</p>
                <p className="vx-imp-resumen-sub">N° {idTransaccion}</p>
              </div>
              <div className="vx-imp-resumen-total">
                <span>Total</span>
                <strong>{modelo ? `Bs ${modelo.total}` : '—'}</strong>
              </div>
            </div>

            <div className="vx-imp-estado" role="status" aria-live="polite">
              <IconoEstado estado={estado} />
              <span>{textoEstado}</span>
              {estado === 'error' && (
                <button type="button" className="vx-imp-enlace" onClick={cargar}>
                  Reintentar
                </button>
              )}
              {estado === 'listo' && (
                <a className="vx-imp-enlace" href={urlFacturaPdf(idTransaccion)} target="_blank" rel="noopener noreferrer">
                  Ver PDF
                </a>
              )}
            </div>
          </div>

          <div className="vx-imp-ranura" aria-hidden="true" />
        </div>

        {/* El papel sale de la ranura hacia abajo; el area se desplaza si el recibo es largo. */}
        <div className="vx-imp-salida" onClick={saltar}>
          {comprobante && (
            <div
              className="vx-imp-papel"
              ref={papelRef}
              style={estado === 'imprimiendo' ? { transform: 'translateY(-101%)' } : undefined}
            >
              <div className="vx-imp-hoja">
                <ReciboTermico modelo={comprobante.modelo} qr={comprobante.qr} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default VistaFactura
