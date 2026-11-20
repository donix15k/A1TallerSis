import Boton from '../ui/Boton.jsx'
import { bs } from '../../utils/formato.js'

export const OBSERVACIONES_MAX = 300
export const LIMITE_AUTORIZACION_BS = 500

/**
 * TDSI-26: motivo (obligatorio), observaciones (hasta 300 caracteres) y resumen con el monto a devolver.
 * El tipo TOTAL/PARCIAL y la marca de autorizacion son una vista previa: los confirma el servidor al registrar.
 */
function FormularioRegistroDevolucion({
  motivos,
  motivoId,
  onMotivo,
  observaciones,
  onObservaciones,
  errorMotivo,
  cantidadProductos,
  monto,
  tipo,
  registrando,
  onRegistrar,
}) {
  const restantes = OBSERVACIONES_MAX - observaciones.length
  const requiereAutorizacion = monto > LIMITE_AUTORIZACION_BS

  return (
    <div className="vxp-grid vxp-grid--2" style={{ alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: '0.9rem' }}>
        <label className={`vxp-campo${errorMotivo ? ' vxp-campo--error' : ''}`}>
          Motivo de la devolución
          <select value={motivoId} onChange={(e) => onMotivo(e.target.value)} aria-invalid={Boolean(errorMotivo)}>
            <option value="">Seleccione el motivo...</option>
            {motivos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
          {errorMotivo && <span className="vxp-campo-error">{errorMotivo}</span>}
        </label>

        <label className="vxp-campo">
          <span style={{ display: 'flex', justifyContent: 'space-between' }}>
            Observaciones <small>(opcional)</small>
          </span>
          <textarea
            value={observaciones}
            maxLength={OBSERVACIONES_MAX}
            onChange={(e) => onObservaciones(e.target.value.slice(0, OBSERVACIONES_MAX))}
            placeholder="Detalle lo que comenta el cliente o el estado del producto"
          />
          <small style={{ textAlign: 'right', color: restantes <= 20 ? 'var(--vxp-warn)' : undefined }}>
            {observaciones.length}/{OBSERVACIONES_MAX}
          </small>
        </label>
      </div>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <div className="vxp-resumen-total">
          <div>
            <small>Monto a devolver</small>
            <span className="vxp-monto">{bs(monto)}</span>
          </div>
          <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
            <span className="vxp-badge vxp-badge--sin-punto" style={{ background: 'rgba(255,255,255,.14)', color: '#fff', borderColor: 'rgba(255,255,255,.25)' }}>
              {tipo}
            </span>
            <span style={{ fontSize: '0.78rem', color: 'rgba(223,232,245,.8)' }}>
              {cantidadProductos} {cantidadProductos === 1 ? 'producto' : 'productos'}
            </span>
          </div>
        </div>
        {requiereAutorizacion && (
          <span className="vxp-badge vxp-badge--warn" style={{ justifySelf: 'start' }}>
            Requiere autorización del supervisor (más de {bs(LIMITE_AUTORIZACION_BS)})
          </span>
        )}
        <Boton variante="exito" tam="lg" icono="check" bloque cargando={registrando} disabled={cantidadProductos === 0} onClick={onRegistrar}>
          Registrar devolución
        </Boton>
      </div>
    </div>
  )
}

export default FormularioRegistroDevolucion
