import Icono from '../ui/Icono.jsx'
import Boton from '../ui/Boton.jsx'
import { bs, fechaHora } from '../../utils/formato.js'

export const ESTADO_BADGE = { PENDIENTE: 'warn', APROBADA: 'ok', RECHAZADA: 'bad', PROCESADA: 'violeta' }
const ESTADO_PRODUCTO = { BUEN_ESTADO: 'En buen estado', DEFECTUOSO: 'Defectuoso' }

/**
 * Detalle de una devolucion (cabecera, productos y motivo) con su accion principal segun el estado:
 * APROBADA -> "Reembolsar" (TDSI-51). Las secciones de la nota de credito, Compras y Marketplace se agregan como hijos.
 */
function DetalleDevolucion({ devolucion: d, onReembolsar, children }) {
  return (
    <div className="vxp-card vxp-escalon">
      <div className="vxp-fila vxp-fila--entre" style={{ marginBottom: '1rem' }}>
        <div className="vxp-fila">
          <span className="vxp-modal-icono">
            <Icono nombre="devolucion" tam={20} />
          </span>
          <div>
            <div className="vxp-fila" style={{ gap: 8 }}>
              <span className="vxp-codigo" style={{ fontSize: '1.2rem', color: 'var(--vx-navy)' }}>{d.codigo}</span>
              <span className={`vxp-badge vxp-badge--${ESTADO_BADGE[d.estado] ?? 'neutro'}`}>{d.estado}</span>
              <span className={`vxp-badge vxp-badge--sin-punto ${d.tipo === 'TOTAL' ? 'vxp-badge--violeta' : 'vxp-badge--neutro'}`}>{d.tipo}</span>
              {d.origen === 'MARKETPLACE' && (
                <span className="vxp-badge vxp-badge--sin-punto" style={{ '--i-c': '#c05621', '--i-bg': '#fff1e6' }}>
                  Marketplace {d.orden_id ? `· ${d.orden_id}` : ''}
                </span>
              )}
            </div>
            <div className="vxp-texto-suave" style={{ fontSize: '0.82rem', marginTop: 2 }}>
              Factura {d.factura_numero} · registrada por {d.cajero_nombre ? `${d.cajero_nombre} (${d.cajero})` : d.cajero} el {fechaHora(d.fecha_solicitud)}
            </div>
          </div>
        </div>
        {d.estado === 'APROBADA' && onReembolsar && (
          <Boton variante="exito" tam="lg" icono="dinero" onClick={onReembolsar}>
            Reembolsar
          </Boton>
        )}
      </div>

      <dl className="vxp-datos">
        <div className="vxp-dato">
          <dt>Monto</dt>
          <dd className="vxp-monto" style={{ fontSize: '1.15rem' }}>{bs(d.monto_total)}</dd>
        </div>
        <div className="vxp-dato">
          <dt>Motivo</dt>
          <dd>{d.motivo?.nombre ?? '—'}</dd>
        </div>
        <div className="vxp-dato">
          <dt>Pago original</dt>
          <dd>{d.metodo_pago_original ?? '—'}</dd>
        </div>
        <div className="vxp-dato">
          <dt>{d.estado === 'RECHAZADA' ? 'Rechazada' : 'Autorizada'}</dt>
          <dd>{d.autorizado_en ? `${d.autorizado_por} · ${fechaHora(d.autorizado_en)}` : d.estado === 'PENDIENTE' ? 'Esperando supervisor' : '—'}</dd>
        </div>
      </dl>

      {d.motivo_rechazo && (
        <div className="vxp-aviso vxp-aviso--bad" style={{ marginTop: '0.9rem' }}>
          <Icono nombre="xCirculo" tam={20} />
          <div>
            <strong>Motivo del rechazo</strong>
            {d.motivo_rechazo}
          </div>
        </div>
      )}
      {d.observaciones && (
        <p className="vxp-texto-suave" style={{ margin: '0.9rem 0 0', fontSize: '0.88rem' }}>
          <strong style={{ color: 'var(--vx-navy)' }}>Observaciones:</strong> {d.observaciones}
        </p>
      )}

      <div className="vxp-tabla-envoltura" style={{ marginTop: '1rem' }}>
        <table className="vxp-tabla">
          <thead>
            <tr>
              <th>Producto devuelto</th>
              <th>Estado</th>
              <th className="num">Cant.</th>
              <th className="num">P. unitario</th>
              <th className="num">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((it) => (
              <tr key={`${it.descripcion}-${it.precio_unitario}`}>
                <td style={{ fontWeight: 600 }}>{it.descripcion}</td>
                <td>
                  {it.estado_producto ? (
                    <span className={`vxp-badge ${it.estado_producto === 'DEFECTUOSO' ? 'vxp-badge--bad' : 'vxp-badge--ok'}`}>
                      {ESTADO_PRODUCTO[it.estado_producto] ?? it.estado_producto}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="num">{it.cantidad}</td>
                <td className="num">{bs(it.precio_unitario)}</td>
                <td className="num vxp-monto">{bs(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {children}
    </div>
  )
}

export default DetalleDevolucion
