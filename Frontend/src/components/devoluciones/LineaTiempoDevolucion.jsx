import { useEffect, useState } from 'react'
import { obtenerHistorialDevolucion } from '../../api/devoluciones.js'
import { Aviso, Esqueleto } from '../ui/Aviso.jsx'
import { fechaHora } from '../../utils/formato.js'

const PASO = {
  PENDIENTE: { titulo: 'Registrada (PENDIENTE)', verbo: 'La registró', color: 'var(--vxp-warn)' },
  APROBADA: { titulo: 'Aprobada', verbo: 'Supervisor que la aprobó', color: 'var(--vxp-ok)' },
  RECHAZADA: { titulo: 'Rechazada', verbo: 'Supervisor que la rechazó', color: 'var(--vxp-bad)' },
  PROCESADA: { titulo: 'Reembolsada (PROCESADA)', verbo: 'Reembolsó', color: '#6b46c1' },
}

/**
 * TDSI-84: linea de tiempo de estados (Pendiente -> Aprobada/Rechazada -> Procesada) con quien hizo cada paso y cuando.
 * Los pasos que todavia no ocurrieron se muestran atenuados para que se vea en que punto esta.
 */
function LineaTiempoDevolucion({ codigo, token }) {
  const [historial, setHistorial] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vigente = true
    setHistorial(null)
    setError(null)
    obtenerHistorialDevolucion(codigo, token)
      .then((r) => vigente && setHistorial(r.data))
      .catch((err) => vigente && setError(err.message))
    return () => {
      vigente = false
    }
  }, [codigo, token])

  if (error) return <Aviso tono="bad" titulo="No se pudo cargar la línea de tiempo">{error}</Aviso>
  if (!historial) return <Esqueleto filas={4} alto={30} />

  const ocurridos = historial.eventos.map((e) => e.estado_nuevo)
  const rechazada = ocurridos.includes('RECHAZADA')
  const esperados = rechazada ? ['PENDIENTE', 'RECHAZADA'] : ['PENDIENTE', 'APROBADA', 'PROCESADA']
  const faltantes = esperados.filter((e) => !ocurridos.includes(e))

  return (
    <ol className="vxp-timeline">
      {historial.eventos.map((e, i) => {
        const paso = PASO[e.estado_nuevo] ?? { titulo: e.estado_nuevo, verbo: 'Por', color: 'var(--vx-steel)' }
        return (
          <li key={i} style={{ animation: `vxp-entra-arriba 300ms var(--vxp-ease) ${i * 60}ms both` }}>
            <span className="vxp-timeline-punto" style={{ '--p-c': paso.color }} />
            <strong>{paso.titulo}</strong>
            <span>
              {paso.verbo}: <b style={{ color: 'var(--vx-navy)' }}>{e.cambiado_por ?? '—'}</b>
            </span>
            <span>{fechaHora(e.cambiado_en)}</span>
          </li>
        )
      })}
      {faltantes.map((estado) => (
        <li key={estado} style={{ opacity: 0.45 }}>
          <span className="vxp-timeline-punto" style={{ '--p-c': '#b6c0cf' }} />
          <strong>{PASO[estado].titulo}</strong>
          <span>Todavía no ocurre</span>
        </li>
      ))}
    </ol>
  )
}

export default LineaTiempoDevolucion
