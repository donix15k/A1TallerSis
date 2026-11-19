import { useEffect, useLayoutEffect, useState } from 'react'
import Isotipo from './Isotipo.jsx'
import './Splash.css'

// Cuanto dura la animacion de entrada antes de empezar a irse, y cuanto tarda en irse.
const DURACION_MS = 2400
const SALIDA_MS = 380

// Pantalla de bienvenida: el logotipo "VORTRIX" se revela y a su lado el isotipo se arma
// pieza por pieza. Se muestra una vez al abrir la pagina (no en cada navegacion interna) y
// se puede saltar con un clic o cualquier tecla. Mientras esta visible pausa las animaciones
// de la pantalla de abajo (clase vx-splash en <html>) para que arranquen al terminar.
function Splash({ onTerminada }) {
  const [saliendo, setSaliendo] = useState(false)

  useLayoutEffect(() => {
    document.documentElement.classList.add('vx-splash')
    return () => document.documentElement.classList.remove('vx-splash')
  }, [])

  useEffect(() => {
    const reducido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const timer = setTimeout(() => setSaliendo(true), reducido ? 900 : DURACION_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!saliendo) return undefined
    // Las animaciones de la pantalla de abajo arrancan apenas empieza la salida.
    document.documentElement.classList.remove('vx-splash')
    const timer = setTimeout(onTerminada, SALIDA_MS)
    return () => clearTimeout(timer)
  }, [saliendo, onTerminada])

  useEffect(() => {
    const saltar = () => setSaliendo(true)
    window.addEventListener('keydown', saltar)
    return () => window.removeEventListener('keydown', saltar)
  }, [])

  return (
    <div
      className={`vx-splash-pantalla${saliendo ? ' vx-splash-pantalla--saliendo' : ''}`}
      role="status"
      aria-label="Cargando Vortrix"
      onClick={() => setSaliendo(true)}
    >
      <div className="vx-splash-brillo" aria-hidden="true" />
      <div className="vx-splash-lockup">
        <Isotipo animacion="armar" className="vx-splash-isotipo" />
        <div className="vx-splash-texto">
          <img className="vx-splash-logotipo" src="/brand/wordmark-light.png" alt="Vortrix" draggable="false" />
          <div className="vx-splash-lema">
            <span className="vx-splash-linea" />
            <span>Gestión de pagos y facturación</span>
            <span className="vx-splash-linea" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default Splash
