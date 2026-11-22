import { useState } from 'react'
import Modal from '../ui/Modal.jsx'
import Boton from '../ui/Boton.jsx'

const MINIMO = 10
const MAXIMO = 400

/**
 * Reenviar a Contabilidad UN asiento que rechazó: Contabilidad no sabe qué se corrigió, así que el reenvío lleva una justificación escrita
 * por quien lo resolvió (cómo se resolvió el motivo del rechazo). Un asiento por vez, nunca todos juntos.
 *   asiento: { referencia, motivo, tipo_nombre? }
 */
function ModalReenvioRechazado({ asiento, enviando = false, onCancelar, onConfirmar }) {
  const [texto, setTexto] = useState('')
  const limpio = texto.trim()
  const valido = limpio.length >= MINIMO

  if (!asiento) return null
  return (
    <Modal
      abierto
      onCerrar={onCancelar}
      bloqueado={enviando}
      icono="recargar"
      tono="warn"
      titulo={`Reenviar ${asiento.referencia} a Contabilidad`}
      subtitulo="Cuéntale a Contabilidad cómo resolviste el rechazo para que sepa qué cambió."
      ancho={560}
      pie={
        <>
          <Boton variante="claro" onClick={onCancelar} disabled={enviando}>
            Cancelar
          </Boton>
          <Boton variante="negro" icono="enviar" cargando={enviando} disabled={!valido} onClick={() => onConfirmar(limpio)}>
            Reenviar a Contabilidad
          </Boton>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="vxp-dato" style={{ padding: '0.7rem 0.85rem' }}>
          <dt>Motivo del rechazo de Contabilidad</dt>
          <dd style={{ color: 'var(--vxp-bad)', fontWeight: 650 }}>{asiento.motivo || 'Sin motivo informado'}</dd>
        </div>
        <label className="vxp-campo" style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontWeight: 700 }}>¿Cómo lo resolviste?</span>
          <textarea
            value={texto}
            maxLength={MAXIMO}
            rows={5}
            autoFocus
            onChange={(e) => setTexto(e.target.value.slice(0, MAXIMO))}
            placeholder="Ej.: Se creó la cuenta contable 4.1.01 y se corrigió el monto del asiento."
            style={{ width: '100%', padding: '0.7rem 0.85rem', border: '1px solid #cfd6e1', borderRadius: 12, font: 'inherit', resize: 'vertical' }}
          />
          <small style={{ display: 'flex', justifyContent: 'space-between', color: valido || !limpio ? undefined : 'var(--vxp-warn)' }}>
            <span>{limpio && !valido ? `Escribe al menos ${MINIMO} caracteres.` : 'Este texto viaja dentro del mensaje que recibe Contabilidad.'}</span>
            <span>{texto.length}/{MAXIMO}</span>
          </small>
        </label>
      </div>
    </Modal>
  )
}

export default ModalReenvioRechazado
