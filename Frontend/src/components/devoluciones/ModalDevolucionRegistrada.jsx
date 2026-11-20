import { useEffect, useState } from 'react'
import Modal from '../ui/Modal.jsx'
import Boton from '../ui/Boton.jsx'
import { bs, copiarTexto } from '../../utils/formato.js'

/** TDSI-27: confirmacion con el codigo DEV-XXXX, el tipo (TOTAL o PARCIAL) y el boton "Copiar código". */
function ModalDevolucionRegistrada({ devolucion, onCerrar }) {
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    if (!copiado) return undefined
    const t = setTimeout(() => setCopiado(false), 1800)
    return () => clearTimeout(t)
  }, [copiado])

  if (!devolucion) return null

  async function copiar() {
    if (await copiarTexto(devolucion.codigo)) setCopiado(true)
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo="Devolución registrada"
      subtitulo="Entregue este código al cliente para que consulte cómo va su devolución."
      icono="checkCirculo"
      tono="ok"
      ancho={480}
      pie={
        <Boton variante="negro" onClick={onCerrar}>
          Listo
        </Boton>
      }
    >
      <div style={{ display: 'grid', justifyItems: 'center', gap: '0.9rem', padding: '0.4rem 0 0.2rem' }}>
        <span className="vxp-codigo-grande">{devolucion.codigo}</span>
        <Boton variante={copiado ? 'exito' : 'claro'} tam="sm" icono={copiado ? 'check' : 'copiar'} onClick={copiar} aria-live="polite">
          {copiado ? 'Código copiado' : 'Copiar código'}
        </Boton>
      </div>
      <dl className="vxp-datos">
        <div className="vxp-dato">
          <dt>Tipo</dt>
          <dd>
            <span className={`vxp-badge ${devolucion.tipo === 'TOTAL' ? 'vxp-badge--violeta' : 'vxp-badge--neutro'}`}>{devolucion.tipo}</span>
          </dd>
        </div>
        <div className="vxp-dato">
          <dt>Monto</dt>
          <dd className="vxp-monto">{bs(devolucion.monto_total)}</dd>
        </div>
        <div className="vxp-dato">
          <dt>Estado</dt>
          <dd>
            <span className="vxp-badge vxp-badge--warn">{devolucion.estado}</span>
          </dd>
        </div>
      </dl>
      {devolucion.requiere_autorizacion && (
        <span className="vxp-badge vxp-badge--warn" style={{ justifySelf: 'center' }}>
          Requiere autorización del supervisor
        </span>
      )}
    </Modal>
  )
}

export default ModalDevolucionRegistrada
