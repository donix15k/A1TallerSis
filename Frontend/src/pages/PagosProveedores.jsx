import { useCallback, useEffect, useState } from 'react'
import { listarOrdenesProveedores, pagarOrdenProveedor, reenviarConfirmacionCompras } from '../api/pagosProveedores.js'
import { useAdminAuth } from '../context/AdminAuthContext.jsx'
import Boton from '../components/ui/Boton.jsx'
import Icono from '../components/ui/Icono.jsx'
import Modal from '../components/ui/Modal.jsx'
import { Aviso, Esqueleto, Vacio } from '../components/ui/Aviso.jsx'
import { useToast } from '../components/ui/Toasts.jsx'
import { bs, fechaHora, numero } from '../utils/formato.js'

const NOMBRE_METODO = { TRANSFERENCIA: 'Transferencia bancaria', CHEQUE: 'Cheque', EFECTIVO: 'Efectivo' }
const SECCIONES = [
  { id: 'PENDIENTE', etiqueta: 'Por pagar' },
  { id: 'LIQUIDADA', etiqueta: 'Pagadas' },
]

/** La ventana para pagar UNA orden: muestra a quien se paga (proveedor, banco, cuenta), el monto (siempre el de la orden) y el metodo. */
function ModalPagar({ orden, metodos, enviando, error, onCancelar, onConfirmar }) {
  const [metodo, setMetodo] = useState(metodos[0] ?? 'TRANSFERENCIA')
  const [descripcion, setDescripcion] = useState('')

  return (
    <Modal
      abierto
      onCerrar={onCancelar}
      bloqueado={enviando}
      ancho={520}
      icono="dinero"
      titulo={`Pagar la orden ${orden.numero}`}
      subtitulo="Se registra el egreso y la orden queda pagada."
      pie={
        <>
          <Boton variante="claro" onClick={onCancelar} disabled={enviando}>
            Cancelar
          </Boton>
          <Boton variante="exito" icono="check" cargando={enviando} onClick={() => onConfirmar({ metodo, descripcion })}>
            Registrar pago de {bs(orden.monto)}
          </Boton>
        </>
      }
    >
      <div className="vxp-resumen-total">
        <div>
          <small>Monto a pagar</small>
          <span className="vxp-monto">{bs(orden.monto)}</span>
        </div>
        <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'rgba(223,232,245,.85)' }}>
          <div>{orden.proveedor}</div>
          <div>NIT {orden.nit}</div>
        </div>
      </div>

      <dl className="pp-datos">
        <div>
          <dt>Banco</dt>
          <dd>{orden.banco}</dd>
        </div>
        <div>
          <dt>Cuenta</dt>
          <dd className="vxp-codigo">{orden.cuenta}</dd>
        </div>
        <div>
          <dt>Concepto</dt>
          <dd>{orden.concepto || '—'}</dd>
        </div>
        <div>
          <dt>Aprobada</dt>
          <dd>
            {orden.fechaEmision} · hace {numero(orden.dias_desde_aprobacion, 0)} días
          </dd>
        </div>
      </dl>

      <label className="vxp-campo">
        Método de pago
        <select value={metodo} onChange={(e) => setMetodo(e.target.value)} disabled={enviando}>
          {metodos.map((m) => (
            <option key={m} value={m}>
              {NOMBRE_METODO[m] ?? m}
            </option>
          ))}
        </select>
      </label>
      <label className="vxp-campo">
        Descripción (opcional)
        <input value={descripcion} maxLength={200} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej.: transferencia 24/11, comprobante 4521" disabled={enviando} />
      </label>

      {error && (
        <Aviso tono="bad" titulo="No se pudo registrar el pago">
          {error}
        </Aviso>
      )}
    </Modal>
  )
}

/**
 * "Pagos a proveedores" del administrador: las ordenes de pago que llegan de Compras. Por pagar (las vencidas, con mas de 15 dias desde su aprobacion,
 * en rojo) y Pagadas (con quien pago y en cuantos dias). Cada pago alimenta el KPI "Dias promedio de pago a proveedores" del Panel de KPIs.
 */
function PagosProveedores() {
  const { administrador } = useAdminAuth()
  const token = administrador?.access_token
  const toast = useToast()
  const [seccion, setSeccion] = useState('PENDIENTE')
  const [respuesta, setRespuesta] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [pagando, setPagando] = useState(null) // orden que se esta por pagar
  const [enviando, setEnviando] = useState(false)
  const [errorPago, setErrorPago] = useState(null)

  const cargar = useCallback(async () => {
    if (!token) return
    setCargando(true)
    setError(null)
    try {
      setRespuesta(await listarOrdenesProveedores(seccion, token))
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [seccion, token])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function reenviar(orden) {
    try {
      await reenviarConfirmacionCompras(orden.numero, token)
      toast.ok(`Confirmación de ${orden.numero} enviada a Compras`)
      cargar()
    } catch (e) {
      toast.error('No se pudo enviar a Compras', e.message)
    }
  }

  async function pagar({ metodo, descripcion }) {
    setEnviando(true)
    setErrorPago(null)
    try {
      const r = await pagarOrdenProveedor(pagando.numero, { metodo, descripcion }, token)
      const compras = r.data?.confirmacion_compras
      toast.ok(`Orden ${pagando.numero} pagada`, `${bs(pagando.monto)} a ${pagando.proveedor} · ${NOMBRE_METODO[metodo] ?? metodo}${compras?.enviada ? ' · confirmado a Compras' : ''}`)
      if (compras && !compras.enviada) toast.aviso('El pago quedó registrado, pero no se pudo confirmar a Compras', 'Puede reenviar la confirmación desde la pestaña Pagadas.')
      setPagando(null)
      cargar()
    } catch (e) {
      setErrorPago(e.message)
    } finally {
      setEnviando(false)
    }
  }

  const ordenes = respuesta?.data ?? []
  const vencidas = ordenes.filter((o) => o.vencida).length

  return (
    <section>
      <header className="vxp-hero" style={{ marginBottom: '1rem' }}>
        <div className="vxp-hero-titulo">
          <span className="vxp-hero-icono">
            <Icono nombre="dinero" tam={24} />
          </span>
          <div>
            <h1>Pagos a proveedores</h1>
            <p>Las órdenes de pago que llegan de Compras: pague cada una y quedará registrada como egreso.</p>
          </div>
        </div>
      </header>

      <div className="vxp-card">
        <div className="vxp-fila vxp-fila--entre" style={{ marginBottom: '1rem', flexWrap: 'wrap', gap: 12 }}>
          <div className="vxp-segmentos" role="tablist" aria-label="Secciones">
            {SECCIONES.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={seccion === s.id} className={`vxp-segmento${seccion === s.id ? ' vxp-segmento--activo' : ''}`} onClick={() => setSeccion(s.id)}>
                {s.etiqueta}
                {s.id === 'PENDIENTE' && respuesta && seccion === 'PENDIENTE' ? ` (${respuesta.pendientes})` : ''}
              </button>
            ))}
          </div>
          <Boton variante="claro" icono="recargar" onClick={cargar} disabled={cargando}>
            Actualizar
          </Boton>
        </div>

        {seccion === 'PENDIENTE' && vencidas > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <Aviso tono="bad" titulo={`${vencidas} ${vencidas === 1 ? 'orden vencida' : 'órdenes vencidas'}`}>
              Pasaron más de {respuesta?.dias_para_vencer ?? 15} días desde su aprobación sin pagarse: conviene pagarlas primero.
            </Aviso>
          </div>
        )}

        {error && (
          <Aviso tono="bad" titulo="No se pudieron cargar las órdenes">
            {error}
          </Aviso>
        )}
        {cargando && ordenes.length === 0 && <Esqueleto filas={5} />}
        {!cargando && !error && ordenes.length === 0 && (
          <Vacio icono="dinero" titulo={seccion === 'PENDIENTE' ? 'No hay órdenes por pagar' : 'Todavía no se pagó ninguna orden'}>
            {seccion === 'PENDIENTE' ? 'Cuando Compras envíe una orden de pago aparecerá aquí.' : 'Las órdenes que pague se verán aquí.'}
          </Vacio>
        )}

        {ordenes.length > 0 && (
          <div className={`dev-tabla${cargando ? ' dev-tabla--cargando' : ''}`}>
            <table className="vxp-tabla">
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Proveedor</th>
                  <th>Concepto</th>
                  <th className="num">Monto</th>
                  <th>Aprobada</th>
                  <th>{seccion === 'PENDIENTE' ? 'Antigüedad' : 'Pagada'}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ordenes.map((o) => (
                  <tr key={o.numero} className={o.vencida ? 'pp-vencida' : undefined}>
                    <td className="vxp-codigo" style={{ fontWeight: 600 }}>{o.numero}</td>
                    <td>
                      {o.proveedor}
                      <small style={{ display: 'block', color: 'var(--vxp-texto-suave)' }}>
                        {o.banco} · {o.cuenta}
                      </small>
                    </td>
                    <td>{o.concepto || '—'}</td>
                    <td className="num vxp-monto">{bs(o.monto)}</td>
                    <td>{o.fechaEmision}</td>
                    <td>
                      {o.estado === 'PENDIENTE' ? (
                        <span className={`vxp-badge ${o.vencida ? 'vxp-badge--bad' : 'vxp-badge--neutro'}`}>
                          {o.vencida ? 'VENCIDA · ' : ''}
                          {numero(o.dias_desde_aprobacion, 0)} días
                        </span>
                      ) : (
                        <>
                          {fechaHora(o.liquidada_en)}
                          <small style={{ display: 'block', color: 'var(--vxp-texto-suave)' }}>
                            por {o.liquidada_por || '—'} · en {numero(o.dias_desde_aprobacion, 1)} días
                          </small>
                        </>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {o.estado === 'PENDIENTE' ? (
                        <Boton variante="exito" tam="sm" icono="dinero" onClick={() => { setErrorPago(null); setPagando(o) }}>
                          Pagar
                        </Boton>
                      ) : (
                        <>
                          <span className="vxp-badge vxp-badge--ok">PAGADA</span>
                          <small style={{ display: 'block', marginTop: 4, color: o.confirmacion_compras === 'Enviado' ? 'var(--kpi-verde)' : '#b45309', fontWeight: 600 }}>
                            {o.confirmacion_compras === 'Enviado' ? 'Compras: confirmado ✓' : `Compras: ${o.confirmacion_compras === 'Error' ? 'no se pudo enviar' : 'sin confirmar'}`}
                          </small>
                          {o.confirmacion_compras !== 'Enviado' && (
                            <Boton variante="claro" tam="sm" icono="enviar" onClick={() => reenviar(o)} style={{ marginTop: 4 }}>
                              Confirmar a Compras
                            </Boton>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagando && <ModalPagar orden={pagando} metodos={respuesta?.metodos ?? ['TRANSFERENCIA']} enviando={enviando} error={errorPago} onCancelar={() => setPagando(null)} onConfirmar={pagar} />}
    </section>
  )
}

export default PagosProveedores
