import { useState } from 'react'
import { reenviarNotaContabilidad } from '../../api/devoluciones.js'
import Boton from '../ui/Boton.jsx'
import { useToast } from '../ui/Toasts.jsx'

const TONO = { Enviado: 'info', Pendiente: 'neutro', Registrado: 'ok', Rechazado: 'bad', Error: 'bad' }

/**
 * TDSI-96/97: estado del aviso de la nota de credito a Contabilidad (Enviado, Registrado con N° de asiento,
 * Rechazado con el motivo o Error). En Error aparece "Reenviar a Contabilidad" y la celda se actualiza al terminar.
 */
function CeldaContabilidad({ devolucion, token, onActualizada }) {
  const [enviando, setEnviando] = useState(false)
  const toast = useToast()
  const c = devolucion.contabilidad

  if (!c) {
    return <span className="vxp-texto-suave" style={{ fontSize: '0.8rem' }}>{devolucion.estado === 'PROCESADA' ? 'Sin envío' : '—'}</span>
  }

  async function reenviar(e) {
    e.stopPropagation()
    setEnviando(true)
    try {
      const r = await reenviarNotaContabilidad(devolucion.codigo, token)
      onActualizada?.({ ...devolucion, contabilidad: r.data.contabilidad })
      if (r.data.contabilidad.estado === 'Error') toast.error('El reenvío volvió a fallar', r.mensaje)
      else toast.ok('Reenviado a Contabilidad', `${devolucion.codigo} · messageId ${r.data.pubsub_message_id ?? 'nuevo'}`)
    } catch (err) {
      toast.error('No se pudo reenviar', err.message)
    } finally {
      setEnviando(false)
    }
  }

  const tono = TONO[c.estado] ?? 'neutro'
  const texto = c.estado === 'Registrado' && c.numero_asiento ? `Registrado – Asiento N° ${c.numero_asiento}` : c.estado

  return (
    <div style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
      <span
        className={`vxp-badge ${tono === 'info' ? '' : `vxp-badge--${tono}`}${c.estado === 'Enviado' ? ' vxp-badge--vivo' : ''}`}
        title={c.motivo ?? undefined}
      >
        {texto}
      </span>
      {c.estado === 'Rechazado' && c.motivo && (
        <span style={{ fontSize: '0.74rem', color: 'var(--vxp-bad)', maxWidth: 220 }}>{c.motivo}</span>
      )}
      {c.estado === 'Error' && (
        <Boton variante="peligro" tam="sm" icono="recargar" cargando={enviando} onClick={reenviar}>
          Reenviar a Contabilidad
        </Boton>
      )}
    </div>
  )
}

export default CeldaContabilidad
