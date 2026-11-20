import { useCallback, useEffect, useState } from 'react'
import { aprobarDevolucion, listarPendientes, rechazarDevolucion } from '../../api/devoluciones.js'
import Boton from '../ui/Boton.jsx'
import { Aviso, Esqueleto, Vacio } from '../ui/Aviso.jsx'
import { useToast } from '../ui/Toasts.jsx'
import ModalDecisionSupervisor from './ModalDecisionSupervisor.jsx'
import { bs, fechaHora, hace } from '../../utils/formato.js'

const REFRESCO_MS = 30000

const ESTADO_BADGE = { PENDIENTE: 'warn', APROBADA: 'ok', RECHAZADA: 'bad', PROCESADA: 'violeta' }

/**
 * TDSI-38: bandeja "Devoluciones pendientes" con el contador y una fila por solicitud (codigo, factura, cajero,
 * monto, motivo y fecha). Aprobar la saca de la bandeja; rechazar actualiza su estado en la tabla sin recargar.
 * Se refresca sola cada 30 s.
 *   onContador(n): avisa cuantas hay pendientes (para la pestaña). columnasExtra / filtro: los agrega el Marketplace.
 */
function BandejaPendientes({ onContador, onAprobada, filtrarFila, renderEtiqueta, filtros }) {
  const [filas, setFilas] = useState([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [decision, setDecision] = useState(null) // { devolucion, accion }
  const toast = useToast()

  const cargar = useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) setCargando(true)
    try {
      const r = await listarPendientes()
      setFilas((previas) => {
        // las rechazadas recien se mantienen visibles (con su nuevo estado) hasta el siguiente refresco manual
        const rechazadas = previas.filter((p) => p.estado === 'RECHAZADA' && silencioso)
        return [...r.data, ...rechazadas.filter((x) => !r.data.some((d) => d.codigo === x.codigo))]
      })
      setTotal(r.total)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
    const t = setInterval(() => !document.hidden && cargar({ silencioso: true }), REFRESCO_MS)
    return () => clearInterval(t)
  }, [cargar])

  useEffect(() => {
    onContador?.(total)
  }, [total, onContador])

  async function confirmar(credenciales) {
    const { devolucion, accion } = decision
    if (accion === 'APROBAR') {
      const r = await aprobarDevolucion(devolucion.codigo, credenciales)
      setFilas((lista) => lista.filter((f) => f.codigo !== devolucion.codigo))
      setTotal((t) => Math.max(0, t - 1))
      toast.ok(`${devolucion.codigo} aprobada`, 'Salió de la bandeja: ya se puede reembolsar.')
      onAprobada?.(r.data)
    } else {
      const r = await rechazarDevolucion(devolucion.codigo, credenciales)
      setFilas((lista) => lista.map((f) => (f.codigo === devolucion.codigo ? { ...f, estado: 'RECHAZADA', motivo_rechazo: r.data.motivo_rechazo } : f)))
      setTotal((t) => Math.max(0, t - 1))
      toast.info(`${devolucion.codigo} rechazada`, r.data.motivo_rechazo)
    }
    setDecision(null)
  }

  const visibles = filtrarFila ? filas.filter(filtrarFila) : filas

  return (
    <div className="vxp-card">
      <h2 className="vxp-card-titulo">
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          Devoluciones pendientes
          <span className={`vxp-badge ${total > 0 ? 'vxp-badge--warn vxp-badge--vivo' : 'vxp-badge--neutro'}`}>{total}</span>
        </span>
        <span className="vxp-fila">
          {filtros}
          <Boton variante="claro" tam="sm" icono="recargar" onClick={() => cargar()} cargando={cargando && filas.length > 0}>
            Actualizar
          </Boton>
        </span>
      </h2>

      {error && <Aviso tono="bad" titulo="No se pudo cargar la bandeja">{error}</Aviso>}

      {cargando && filas.length === 0 ? (
        <Esqueleto filas={4} alto={22} />
      ) : visibles.length === 0 && !error ? (
        <Vacio icono="checkCirculo" titulo="Bandeja al día">
          No hay devoluciones esperando la revisión de un supervisor.
        </Vacio>
      ) : (
        <div className="vxp-tabla-envoltura">
          <table className="vxp-tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Factura</th>
                <th>Cajero</th>
                <th className="num">Monto</th>
                <th>Motivo</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((d) => (
                <tr key={d.codigo}>
                  <td>
                    <span className="vxp-codigo">{d.codigo}</span>
                    {renderEtiqueta?.(d)}
                  </td>
                  <td className="vxp-codigo" style={{ fontWeight: 600 }}>{d.factura_numero}</td>
                  <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={d.cajero}>{d.cajero}</td>
                  <td className="num">
                    <span className="vxp-monto">{bs(d.monto_total)}</span>
                    {d.requiere_autorizacion && (
                      <div>
                        <span className="vxp-badge vxp-badge--warn vxp-badge--sin-punto" style={{ marginTop: 4, fontSize: '0.66rem' }}>
                          Requiere autorización
                        </span>
                      </div>
                    )}
                  </td>
                  <td>{d.motivo?.nombre ?? '—'}</td>
                  <td title={fechaHora(d.fecha_solicitud)}>
                    {fechaHora(d.fecha_solicitud)}
                    <div className="vxp-texto-suave" style={{ fontSize: '0.75rem' }}>{hace(d.fecha_solicitud)}</div>
                  </td>
                  <td>
                    <span className={`vxp-badge vxp-badge--${ESTADO_BADGE[d.estado] ?? 'neutro'}`}>{d.estado}</span>
                  </td>
                  <td>
                    {d.estado === 'PENDIENTE' ? (
                      <div className="vxp-fila vxp-fila--fin" style={{ flexWrap: 'nowrap' }}>
                        <Boton variante="exito" tam="sm" icono="check" onClick={() => setDecision({ devolucion: d, accion: 'APROBAR' })}>
                          Aprobar
                        </Boton>
                        <Boton variante="claro" tam="sm" icono="x" onClick={() => setDecision({ devolucion: d, accion: 'RECHAZAR' })}>
                          Rechazar
                        </Boton>
                      </div>
                    ) : (
                      <span className="vxp-texto-suave" style={{ fontSize: '0.8rem' }} title={d.motivo_rechazo}>
                        Resuelta
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {decision && (
        <ModalDecisionSupervisor
          key={`${decision.devolucion.codigo}-${decision.accion}`}
          devolucion={decision.devolucion}
          accion={decision.accion}
          onConfirmar={confirmar}
          onCerrar={() => setDecision(null)}
        />
      )}
    </div>
  )
}

export default BandejaPendientes
