import Icono from '../ui/Icono.jsx'
import { bs, fecha, fechaHora } from '../../utils/formato.js'

const ICONO_METODO = { Efectivo: 'dinero', Tarjeta: 'tarjeta', QR: 'qr', Vale: 'vale', Mixto: 'lista' }

/** TDSI-14: fecha, cliente, metodo de pago y total de la factura, con el estado del plazo de devolucion. */
function DatosFactura({ factura, plazo, devolvible }) {
  const quedan = plazo ? plazo.dias_limite - plazo.dias_transcurridos : null
  return (
    <>
      <div className="vxp-fila vxp-fila--entre" style={{ marginBottom: '0.9rem' }}>
        <div className="vxp-fila">
          <span className="vxp-modal-icono">
            <Icono nombre="factura" tam={20} />
          </span>
          <div>
            <div className="vxp-codigo" style={{ fontSize: '1.15rem', color: 'var(--vx-navy)' }}>{factura.numero}</div>
            <div className="vxp-texto-suave" style={{ fontSize: '0.82rem' }}>Emitida el {fechaHora(factura.fecha)}</div>
          </div>
        </div>
        {plazo &&
          (plazo.dentro_de_plazo && devolvible ? (
            <span className="vxp-badge vxp-badge--ok">
              Dentro de plazo · {quedan === 0 ? 'último día' : `quedan ${quedan} ${quedan === 1 ? 'día' : 'días'}`} (hasta {fecha(`${plazo.fecha_limite}T12:00:00-04:00`)})
            </span>
          ) : !plazo.dentro_de_plazo ? (
            <span className="vxp-badge vxp-badge--bad">Fuera de plazo · {plazo.dias_transcurridos} días</span>
          ) : (
            <span className="vxp-badge vxp-badge--bad">Factura {String(factura.estado).toLowerCase()}</span>
          ))}
      </div>
      <dl className="vxp-datos">
        <div className="vxp-dato">
          <dt>Fecha</dt>
          <dd>{fecha(factura.fecha)}</dd>
        </div>
        <div className="vxp-dato">
          <dt>Cliente</dt>
          <dd>
            {factura.cliente_nombre || 'Sin nombre'}
            <div className="vxp-texto-suave" style={{ fontSize: '0.78rem', fontWeight: 500 }}>NIT/CI {factura.cliente_nit || '0'}</div>
          </dd>
        </div>
        <div className="vxp-dato">
          <dt>Método de pago</dt>
          <dd style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icono nombre={ICONO_METODO[factura.metodo_pago] ?? 'dinero'} tam={16} />
            {factura.metodo_pago || 'No registrado'}
          </dd>
          {factura.metodos_pago?.length > 1 && (
            <div className="vxp-texto-suave" style={{ fontSize: '0.75rem', marginTop: 4 }}>
              {factura.metodos_pago.map((m) => `${m.metodo} ${bs(m.monto)}`).join(' · ')}
            </div>
          )}
        </div>
        <div className="vxp-dato">
          <dt>Total</dt>
          <dd className="vxp-monto" style={{ fontSize: '1.15rem' }}>{bs(factura.total)}</dd>
        </div>
      </dl>
    </>
  )
}

export default DatosFactura
