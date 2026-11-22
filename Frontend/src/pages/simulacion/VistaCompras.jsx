import { useCallback, useEffect, useRef, useState } from 'react'
import MarcoSimulacion from '../../components/simulacion/MarcoSimulacion.jsx'
import Icono from '../../components/ui/Icono.jsx'
import { useToast } from '../../components/ui/Toasts.jsx'
import { acusarCompras, enviarOrdenCompras, listarOrdenesCompras, listarProveedoresCompras, listarReportesCompras } from '../../api/simulacion.js'
import usePolling from '../../hooks/usePolling.js'
import { bs, fecha, hace } from '../../utils/formato.js'

function Contenido({ token }) {
  const toast = useToast()
  const [reportes, setReportes] = useState(null)
  const [ordenes, setOrdenes] = useState(null)
  const [proveedores, setProveedores] = useState([])
  const [error, setError] = useState(null)
  const [acusando, setAcusando] = useState(null)
  const [esperandoAcuse, setEsperandoAcuse] = useState(() => new Set())
  const [form, setForm] = useState({ proveedor_id: 'andina', monto: '', concepto: '', dias_vencimiento: '30' })
  const [enviando, setEnviando] = useState(false)
  const montado = useRef(true)

  const cargarReportes = useCallback(async () => {
    try {
      const r = await listarReportesCompras(token)
      if (montado.current) setReportes(r.data)
    } catch (e) {
      if (montado.current) setError(e.message)
    }
  }, [token])
  const cargarOrdenes = useCallback(async () => {
    try {
      const r = await listarOrdenesCompras(token)
      if (montado.current) setOrdenes(r.data)
    } catch (e) {
      if (montado.current) setError(e.message)
    }
  }, [token])

  useEffect(() => {
    montado.current = true
    cargarReportes()
    cargarOrdenes()
    listarProveedoresCompras(token).then((r) => montado.current && setProveedores(r.data)).catch((e) => setError(e.message))
    return () => { montado.current = false }
  }, [token, cargarReportes, cargarOrdenes])

  usePolling(cargarReportes, esperandoAcuse.size > 0 ? 3000 : 12000)
  usePolling(cargarOrdenes, 12000)

  useEffect(() => {
    // un acuse deja de "esperar" cuando A1 ya marco el reporte como Recibido
    if (!reportes) return
    setEsperandoAcuse((s) => {
      const n = new Set([...s].filter((id) => reportes.find((r) => r.reporte_id === id)?.estado !== 'Recibido'))
      return n.size === s.size ? s : n
    })
  }, [reportes])

  async function acusar(r) {
    setAcusando(r.reporte_id)
    try {
      await acusarCompras(r.reporte_id, token)
      toast.ok(`Acuse de ${r.reporte_id} enviado`, 'Compras confirmó la recepción por Pub/Sub. A1 lo marcará como Recibido en unos segundos.')
      setEsperandoAcuse((s) => new Set(s).add(r.reporte_id))
    } catch (e) {
      toast.error('No se pudo enviar el acuse', e.message)
    } finally {
      setAcusando(null)
    }
  }

  async function enviarOrden(e) {
    e.preventDefault()
    setEnviando(true)
    try {
      const r = await enviarOrdenCompras({ proveedor_id: form.proveedor_id, monto: Number(form.monto), concepto: form.concepto.trim() || undefined, dias_vencimiento: Number(form.dias_vencimiento) }, token)
      toast.ok(`Orden ${r.data.numero} entregada`, `${r.data.proveedor} · ${bs(r.data.monto)} · vence el ${fecha(r.data.vence)}`)
      setForm({ ...form, monto: '', concepto: '' })
      cargarOrdenes()
    } catch (err) {
      toast.error('No se pudo entregar la orden', err.message)
    } finally {
      setEnviando(false)
    }
  }

  const proveedor = proveedores.find((p) => p.id === form.proveedor_id)
  return (
    <>
      <div className="sim-explica sim-entra">
        <span><Icono nombre="camion" tam={20} /></span>
        <p>
          Estás viendo <strong>lo que hace Compras</strong>: <strong>confirma</strong> (acuse por Pub/Sub) que recibió nuestro reporte de productos vendidos y le <strong>entrega órdenes de pago aprobadas</strong> a Pagos a Proveedores.
          Al volver, los reportes figuran como <em>Recibido</em> y las órdenes aparecen en la bandeja del administrador.
        </p>
      </div>

      {error && <div className="sim-aviso sim-aviso--bad" role="alert">{error}</div>}

      <div className="sim-grid sim-grid--parejo">
        <section className="sim-panel sim-entra">
          <div className="sim-panel-cab">
            <h2><Icono nombre="grafico" tam={20} /> Reportes de productos vendidos</h2>
            <span className="sim-contador">{reportes ? reportes.filter((r) => r.puede_acusar).length : '…'}</span>
          </div>
          <div className="sim-panel-cuerpo sim-panel-cuerpo--lista">
            {!reportes ? (
              <div className="sim-lista"><div className="sim-esqueleto" /><div className="sim-esqueleto" /></div>
            ) : reportes.length === 0 ? (
              <div className="sim-vacio"><span><Icono nombre="bandeja" tam={26} /></span><b>Aún no enviamos reportes</b>Envía los productos vendidos del día a Compras desde Pagos y Facturación.</div>
            ) : (
              <ul className="sim-lista">
                {reportes.slice(0, 10).map((r) => {
                  const espera = esperandoAcuse.has(r.reporte_id)
                  return (
                    <li key={r.reporte_id} className="sim-fila">
                      <span className="sim-icono"><Icono nombre="grafico" tam={22} /></span>
                      <div><b>{r.reporte_id}</b><small>Reporte del {fecha(r.fecha)} · enviado {hace(r.enviado_en)}</small></div>
                      {r.estado === 'Recibido' ? (
                        <span className="sim-chip sim-chip--ok"><Icono nombre="check" tam={13} /> Recibido</span>
                      ) : espera ? (
                        <span className="sim-chip sim-chip--warn sim-chip--espera"><i /> A1 lo está procesando</span>
                      ) : r.puede_acusar ? (
                        <button type="button" className="sim-btn" disabled={acusando !== null} onClick={() => acusar(r)}>
                          <Icono nombre={acusando === r.reporte_id ? 'recargar' : 'check'} tam={17} className={acusando === r.reporte_id ? 'sim-giro' : undefined} /> Confirmar recepción
                        </button>
                      ) : (
                        <span className="sim-chip sim-chip--bad">{r.estado}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        <form className="sim-panel sim-entra" onSubmit={enviarOrden}>
          <div className="sim-panel-cab"><h2><Icono nombre="dinero" tam={20} /> Nueva orden de pago a proveedor</h2></div>
          <div className="sim-panel-cuerpo" style={{ display: 'grid', gap: 14 }}>
            <div className="sim-campo">
              <span>Proveedor</span>
              <div className="sim-filtros" role="group" aria-label="Proveedor">
                {proveedores.map((p) => (
                  <button key={p.id} type="button" className="sim-filtro" aria-pressed={form.proveedor_id === p.id} onClick={() => setForm({ ...form, proveedor_id: p.id })}>{p.razonSocial}</button>
                ))}
              </div>
              {proveedor && <small style={{ color: '#64748b' }}>NIT {proveedor.nit} · {proveedor.banco} · cuenta {proveedor.cuentaBancaria}</small>}
            </div>
            <div className="sim-campos">
              <label className="sim-campo"><span>Monto (Bs)</span><input className="sim-entrada" type="number" min="0.01" step="0.01" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} placeholder="3450.00" required /></label>
              <label className="sim-campo"><span>Vence en (días)</span><input className="sim-entrada" type="number" min="1" max="365" value={form.dias_vencimiento} onChange={(e) => setForm({ ...form, dias_vencimiento: e.target.value })} required /></label>
            </div>
            <label className="sim-campo"><span>Concepto</span><input className="sim-entrada" maxLength={200} value={form.concepto} onChange={(e) => setForm({ ...form, concepto: e.target.value })} placeholder="Compra de mercadería (opcional)" /></label>
            <button type="submit" className="sim-btn sim-btn--grande sim-btn--bloque" disabled={enviando || !form.monto}>
              <Icono nombre={enviando ? 'recargar' : 'enviar'} tam={19} className={enviando ? 'sim-giro' : undefined} /> {enviando ? 'Entregando…' : 'Entregar orden a Pagos a Proveedores'}
            </button>
            <small style={{ color: '#64748b' }}>La orden se publica por Pub/Sub en el tópico de A1; Pagos a Proveedores la lee de su suscripción y el administrador la ve como pendiente de pago.</small>
          </div>
        </form>
      </div>

      <section className="sim-panel sim-entra">
        <div className="sim-panel-cab">
          <h2><Icono nombre="bandeja" tam={20} /> Órdenes pendientes que ve Pagos a Proveedores</h2>
          <span className="sim-contador">{ordenes ? ordenes.ordenes.length : '…'}</span>
        </div>
        <div className="sim-panel-cuerpo">
          {ordenes?.error && <div className="sim-aviso sim-aviso--warn" style={{ marginBottom: 12 }}>{ordenes.error}</div>}
          {ordenes && ordenes.ordenes.length === 0 ? (
            <div className="sim-vacio"><span><Icono nombre="checkCirculo" tam={26} /></span><b>Sin órdenes pendientes</b>Entrega una orden con el formulario de arriba.</div>
          ) : (
            <div className="sim-tabla-scroll">
              <table className="sim-tabla">
                <thead><tr><th>Orden</th><th>Proveedor</th><th className="sim-num">Monto</th><th>Emitida</th><th>Vence</th><th>Estado</th></tr></thead>
                <tbody>
                  {(ordenes?.ordenes ?? []).map((o) => (
                    <tr key={o.id}>
                      <td><b>{o.id}</b></td>
                      <td>{o.proveedor}</td>
                      <td className="sim-num"><b>{bs(o.monto)}</b></td>
                      <td>{o.fechaEmision ? fecha(o.fechaEmision) : '—'}</td>
                      <td>{o.fechaVencimiento ? fecha(o.fechaVencimiento) : '—'}</td>
                      <td><span className="sim-chip sim-chip--warn">{o.estado}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  )
}

export default function VistaCompras() {
  return (
    <MarcoSimulacion vista="compras" letra="C" titulo="Compras y Proveedores" volverA="/admin/productos-vendidos">
      {({ token }) => <Contenido token={token} />}
    </MarcoSimulacion>
  )
}
