import { useState } from 'react'
import Modal from '../ui/Modal.jsx'
import Boton from '../ui/Boton.jsx'
import Icono from '../ui/Icono.jsx'
import { Aviso } from '../ui/Aviso.jsx'
import { bs, fechaHora } from '../../utils/formato.js'

export const MOTIVO_RECHAZO_MIN = 10
const MOTIVO_RECHAZO_MAX = 300

/**
 * TDSI-39/40: "Autorizar devolución" (usuario y PIN del supervisor, con el PIN oculto) y "Rechazar devolución"
 * (ademas el motivo, de al menos 10 caracteres). Mismo orden que el modal de anulacion de ventas: resumen de lo que
 * se autoriza, usuario del supervisor y PIN. Si el PIN es incorrecto el modal sigue abierto con el error.
 *   accion: 'APROBAR' | 'RECHAZAR'
 */
function ModalDecisionSupervisor({ devolucion, accion, onConfirmar, onCerrar }) {
  const [supervisorId, setSupervisorId] = useState('')
  const [pin, setPin] = useState('')
  const [verPin, setVerPin] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)
  const [intentos, setIntentos] = useState(null)

  if (!devolucion) return null
  const esRechazo = accion === 'RECHAZAR'
  const motivoCorto = motivo.trim().length < MOTIVO_RECHAZO_MIN

  async function enviar(e) {
    e.preventDefault()
    if (!supervisorId.trim() || !pin.trim()) {
      setError('Ingrese el usuario y el PIN del supervisor.')
      return
    }
    if (esRechazo && motivoCorto) {
      setError(`El motivo del rechazo debe tener al menos ${MOTIVO_RECHAZO_MIN} caracteres.`)
      return
    }
    setEnviando(true)
    setError(null)
    try {
      await onConfirmar({ supervisor_id: supervisorId.trim(), pin: pin.trim(), ...(esRechazo && { motivo_rechazo: motivo.trim() }) })
    } catch (err) {
      setError(err.status === 401 ? 'Usuario o PIN incorrecto' : err.message)
      setIntentos(err.detalle?.intentos_restantes ?? err.intentos_restantes ?? null)
      setPin('')
      setEnviando(false)
    }
  }

  const cambiar = (setter) => (e) => {
    setter(e.target.value)
    if (error) setError(null)
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      bloqueado={enviando}
      ancho={500}
      icono={esRechazo ? 'xCirculo' : 'escudo'}
      tono={esRechazo ? 'bad' : undefined}
      titulo={esRechazo ? 'Rechazar devolución' : 'Autorizar devolución'}
      subtitulo={esRechazo ? 'Escriba por qué se rechaza y confirme con su usuario y PIN.' : 'Se necesita el usuario y el PIN de un supervisor.'}
      pie={
        <>
          <Boton variante="claro" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Boton>
          <Boton
            type="submit"
            form="form-decision-devolucion"
            variante={esRechazo ? 'peligro' : 'exito'}
            icono={esRechazo ? 'x' : 'check'}
            cargando={enviando}
          >
            {esRechazo ? 'Rechazar devolución' : 'Aprobar devolución'}
          </Boton>
        </>
      }
    >
      <div className="vxp-resumen-total" style={{ padding: '0.85rem 1rem' }}>
        <div>
          <small>{devolucion.codigo} · Factura {devolucion.factura_numero}</small>
          <span className="vxp-monto">{bs(devolucion.monto_total)}</span>
        </div>
        <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'rgba(223,232,245,.85)' }}>
          <div>{devolucion.motivo?.nombre ?? 'Sin motivo'}</div>
          <div>{devolucion.cajero}{devolucion.cajero_nombre ? <small style={{ display: 'block' }}>{devolucion.cajero_nombre}</small> : null}</div>
          <div>{fechaHora(devolucion.fecha_solicitud)}</div>
        </div>
      </div>

      <form id="form-decision-devolucion" onSubmit={enviar} style={{ display: 'grid', gap: '0.85rem' }} autoComplete="off">
        {esRechazo && (
          <label className={`vxp-campo${error && motivoCorto ? ' vxp-campo--error' : ''}`}>
            Motivo del rechazo
            <textarea
              value={motivo}
              maxLength={MOTIVO_RECHAZO_MAX}
              onChange={cambiar(setMotivo)}
              placeholder="Ej.: el producto muestra uso y no corresponde a un defecto de fábrica"
            />
            <small style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: motivoCorto ? 'var(--vxp-warn)' : 'var(--vxp-ok)' }}>
                {motivoCorto ? `Faltan ${MOTIVO_RECHAZO_MIN - motivo.trim().length} caracteres` : 'Motivo suficiente'}
              </span>
              <span>
                {motivo.length}/{MOTIVO_RECHAZO_MAX}
              </span>
            </small>
          </label>
        )}

        <label className="vxp-campo">
          Usuario del supervisor
          <input type="text" value={supervisorId} onChange={cambiar(setSupervisorId)} autoComplete="off" />
        </label>

        <label className="vxp-campo">
          PIN del supervisor
          <div style={{ position: 'relative' }}>
            <input
              type={verPin ? 'text' : 'password'}
              inputMode="numeric"
              value={pin}
              onChange={cambiar(setPin)}
              autoComplete="new-password"
              style={{ paddingRight: 44, letterSpacing: verPin ? '0.1em' : '0.3em' }}
            />
            <button
              type="button"
              className="vxp-icono-btn"
              onClick={() => setVerPin((v) => !v)}
              aria-label={verPin ? 'Ocultar PIN' : 'Mostrar PIN'}
              style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
              tabIndex={-1}
            >
              <Icono nombre={verPin ? 'ojo' : 'candado'} tam={17} />
            </button>
          </div>
        </label>

        {error && (
          <Aviso tono="bad" titulo={error}>
            {intentos != null && `Le quedan ${intentos} ${intentos === 1 ? 'intento' : 'intentos'} antes del bloqueo.`}
          </Aviso>
        )}
      </form>
    </Modal>
  )
}

export default ModalDecisionSupervisor
