import { useCallback, useEffect, useRef, useState } from 'react'
import Isotipo from '../Isotipo.jsx'
import Boton from '../ui/Boton.jsx'
import { CuponVale, imprimirCupon } from './CuponVale.jsx'

const menosMovimiento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// El cupon sale de la ranura de IZQUIERDA A DERECHA, a tirones cortos como una impresora termica (la del recibo sale de arriba hacia abajo).
function cuadrosDeAvance(anchoPx) {
  const pasos = Math.max(6, Math.round(anchoPx / 90))
  return Array.from({ length: pasos + 1 }, (_, i) => ({
    offset: i / pasos,
    transform: `translateX(-${((1 - i / pasos) * 100).toFixed(3)}%)`,
    easing: 'cubic-bezier(0.45, 0, 0.3, 1)',
  }))
}

const TEXTO = { imprimiendo: 'Imprimiendo cupón…', listo: 'Cupón listo' }

/**
 * Vista del cupon: una impresora acostada a la izquierda y el cupon saliendo por su ranura hacia la derecha.
 * Clic sobre el cupon o Espacio para terminar de sacarlo; "Imprimir" manda SOLO el cupon a la impresora.
 */
function ImpresoraCupon({ cupon, onCerrar }) {
  const [estado, setEstado] = useState('imprimiendo') // imprimiendo | listo
  const papelRef = useRef(null)
  const animacionRef = useRef(null)
  const botonCerrarRef = useRef(null)

  useEffect(() => {
    if (menosMovimiento() || !papelRef.current) {
      setEstado('listo')
      return undefined
    }
    const papel = papelRef.current
    const animacion = papel.animate(cuadrosDeAvance(papel.offsetWidth), { duration: 2600, easing: 'linear', fill: 'forwards' })
    animacionRef.current = animacion
    animacion.finished.then(() => setEstado('listo')).catch(() => {})
    return () => animacion.cancel()
  }, [cupon?.codigo])

  const saltar = useCallback(() => {
    if (animacionRef.current && estado === 'imprimiendo') animacionRef.current.finish()
  }, [estado])

  useEffect(() => {
    function alTeclear(e) {
      if (e.key === 'Escape') onCerrar()
      if (e.key === ' ' && estado === 'imprimiendo') {
        e.preventDefault()
        saltar()
      }
    }
    document.addEventListener('keydown', alTeclear)
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    botonCerrarRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', alTeclear)
      document.body.style.overflow = previo
    }
  }, [onCerrar, estado, saltar])

  return (
    <div className="cimp-fondo" role="dialog" aria-modal="true" aria-label={`Cupón ${cupon.codigo}`} onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="cimp">
        <div className={`cimp-fila${estado === 'imprimiendo' ? ' cimp-fila--trabajando' : ''}`}>
          <div className="cimp-maquina">
            <div className="cimp-maquina-cabecera">
              <span className="cimp-logo">
                <Isotipo />
              </span>
              <button type="button" className="cimp-cerrar" onClick={onCerrar} ref={botonCerrarRef} aria-label="Cerrar">
                ✕
              </button>
            </div>
            <div className="cimp-pantalla" role="status" aria-live="polite">
              <span className={`cimp-luz${estado === 'listo' ? ' cimp-luz--ok' : ''}`} />
              {TEXTO[estado]}
            </div>
            <p className="cimp-dato">
              <span>Cupón</span>
              <strong>{cupon.codigo}</strong>
            </p>
            <div className="cimp-ranura" aria-hidden="true" />
          </div>

          <div className="cimp-salida" onClick={saltar}>
            <div className="cimp-papel" ref={papelRef} style={estado === 'imprimiendo' ? { transform: 'translateX(-101%)' } : undefined}>
              <CuponVale cupon={cupon} />
            </div>
          </div>
        </div>

        <div className="cimp-acciones">
          <Boton variante="claro" onClick={onCerrar}>
            Cerrar
          </Boton>
          <Boton icono="imprimir" onClick={() => imprimirCupon(cupon)} disabled={estado !== 'listo'}>
            Imprimir cupón
          </Boton>
        </div>
      </div>
    </div>
  )
}

export default ImpresoraCupon
