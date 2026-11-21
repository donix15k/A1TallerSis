import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAdminAuth } from '../../context/AdminAuthContext.jsx'
import { obtenerContextoVista } from '../../api/simulacion.js'
import Icono from '../ui/Icono.jsx'

/** Cambia de pantalla RECARGANDO la página (como pidió el flujo: entrar y salir de la vista de otro grupo es un cambio de "sistema"). */
export function irConRecarga(ruta) {
  window.location.assign(ruta)
}

const corto = (topico) => String(topico ?? '').split('/topics/')[1] ?? topico

/**
 * Marco común de las vistas "como si fuéramos" otro grupo. Solo se ve esa parte (sin el menú de Pagos y Facturación): una barra con el
 * grupo, la cinta SIMULACIÓN, la ruta del mensaje (de qué tópico a qué tópico viaja lo que se envía aquí) y el botón para volver.
 */
function MarcoSimulacion({ vista, letra, titulo, volverA, volverTexto = 'Volver a Pagos y Facturación', children }) {
  const { administrador } = useAdminAuth()
  const token = administrador?.access_token
  const [contexto, setContexto] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!token) return
    obtenerContextoVista(vista, token)
      .then((r) => {
        setContexto(r.data)
        setError(null) // un intento anterior que falló por lentitud ya no cuenta
      })
      .catch((e) => setError(e.message))
  }, [vista, token])

  if (!administrador) return <Navigate to="/login" replace />

  const simulado = contexto?.simulado
  return (
    <div className={`sim sim--${vista}`}>
      <header className="sim-barra">
        <div className="sim-barra-interior">
          <div className="sim-marca">
            <span className="sim-insignia" aria-hidden="true">{letra}</span>
            <div>
              <h1>{titulo}</h1>
              <p>{contexto ? `${contexto.nombre} · Grupo ${contexto.grupo}` : 'Cargando grupo…'}</p>
            </div>
          </div>
          <span className="sim-cinta"><i /> Simulación</span>
          <button type="button" className="sim-volver" onClick={() => irConRecarga(volverA)}>
            <Icono nombre="flecha" tam={18} /> {volverTexto}
          </button>
        </div>
        <div className="sim-ruta" aria-label="Ruta del mensaje por Pub/Sub">
          <div className="sim-nodo sim-nodo--origen">
            <b>{contexto?.grupo ?? '…'}</b>
            <div>
              <small>Publicas como {contexto?.sistema_origen ?? '…'}</small>
              <code>{simulado ? corto(simulado.de.topico) : '…'}</code>
            </div>
          </div>
          <span className="sim-flecha"><Icono nombre="flecha" tam={22} /></span>
          <div className="sim-nodo">
            <b>A1</b>
            <div>
              <small>Llega a Pagos y Facturación</small>
              <code>{simulado ? corto(simulado.a.topico) : '…'}</code>
            </div>
          </div>
        </div>
      </header>
      <main className="sim-cuerpo">
        {error && <div className="sim-aviso sim-aviso--bad" role="alert">No se pudo cargar la vista: {error}</div>}
        {children({ token, contexto })}
      </main>
    </div>
  )
}

export default MarcoSimulacion
