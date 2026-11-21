import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MarcoSimulacion from '../../components/simulacion/MarcoSimulacion.jsx'
import Icono from '../../components/ui/Icono.jsx'
import { useToast } from '../../components/ui/Toasts.jsx'
import { enviarVentaMarketplace, listarProductosMarketplace, listarVentasMarketplace } from '../../api/simulacion.js'
import usePolling from '../../hooks/usePolling.js'
import { bs, hace, numero } from '../../utils/formato.js'

const METODOS = [
  { valor: 'QR', icono: 'qr' },
  { valor: 'Tarjeta', icono: 'tarjeta' },
  { valor: 'Efectivo', icono: 'dinero' },
]
const MAX = 50

function Contenido({ token }) {
  const toast = useToast()
  const [productos, setProductos] = useState(null)
  const [ventas, setVentas] = useState(null)
  const [error, setError] = useState(null)
  const [categoria, setCategoria] = useState('Todos')
  const [cantidades, setCantidades] = useState({}) // sku -> unidades
  const [cliente, setCliente] = useState({ nit: '', razon_social: '', email: '' })
  const [metodo, setMetodo] = useState('QR')
  const [enviando, setEnviando] = useState(false)
  const [esperando, setEsperando] = useState(null) // { orden_id, desde }
  const montado = useRef(true)

  const cargarVentas = useCallback(async () => {
    try {
      const r = await listarVentasMarketplace(token)
      if (montado.current) setVentas(r.data)
    } catch (e) {
      if (montado.current) setError(e.message)
    }
  }, [token])

  useEffect(() => {
    montado.current = true
    listarProductosMarketplace(token).then((r) => montado.current && setProductos(r.data)).catch((e) => setError(e.message))
    cargarVentas()
    return () => { montado.current = false }
  }, [token, cargarVentas])

  // tras enviar una venta se consulta seguido hasta que Pagos y Facturacion la recibe (o pasan ~90 s)
  usePolling(() => {
    cargarVentas()
    setEsperando((e) => (e && Date.now() - e.desde > 90000 ? null : e))
  }, 3000, Boolean(esperando))
  usePolling(cargarVentas, 12000, !esperando)

  const categorias = useMemo(() => ['Todos', ...new Set((productos ?? []).map((p) => p.categoria))], [productos])
  const visibles = (productos ?? []).filter((p) => categoria === 'Todos' || p.categoria === categoria)
  const lineas = (productos ?? []).filter((p) => cantidades[p.sku] > 0).map((p) => ({ ...p, cantidad: cantidades[p.sku] }))
  const unidades = lineas.reduce((a, l) => a + l.cantidad, 0)
  const total = lineas.reduce((a, l) => a + Math.round(l.cantidad * l.precio * 100), 0) / 100

  const cambiar = (sku, delta) => setCantidades((c) => ({ ...c, [sku]: Math.max(0, Math.min(MAX, (c[sku] ?? 0) + delta)) }))
  const ventaRecibida = esperando && ventas?.find((v) => v.orden_id === esperando.orden_id)

  useEffect(() => {
    if (ventaRecibida?.numero_factura) setEsperando(null) // ya se recibio y se facturo: se deja de consultar seguido
  }, [ventaRecibida])

  async function enviar(e) {
    e.preventDefault()
    if (lineas.length === 0) return toast.aviso('Elige al menos un producto')
    setEnviando(true)
    try {
      const r = await enviarVentaMarketplace(
        { items: lineas.map((l) => ({ sku: l.sku, cantidad: l.cantidad })), nit: cliente.nit.trim(), razon_social: cliente.razon_social.trim(), email: cliente.email.trim() || undefined, metodo_pago: metodo },
        token,
      )
      toast.ok(`Venta ${r.data.orden_id} enviada`, `${r.data.items} producto(s) · ${bs(r.data.total)} · publicada en Pub/Sub hacia A1`)
      setEsperando({ orden_id: r.data.orden_id, desde: Date.now() })
      setCantidades({})
    } catch (err) {
      toast.error('No se pudo enviar la venta', err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <div className="sim-explica sim-entra">
        <span><Icono nombre="tienda" tam={20} /></span>
        <p>
          Estás viendo <strong>lo que hace el Marketplace</strong>: un cliente arma su pedido y el Marketplace lo manda por Pub/Sub al tópico de A1.
          Pagos y Facturación la recibe, <strong>emite su factura de verdad</strong> y la venta aparece en <strong>Ventas online</strong> al volver.
        </p>
      </div>

      {error && <div className="sim-aviso sim-aviso--bad" role="alert">{error}</div>}

      <div className="sim-grid sim-grid--2">
        <section className="sim-panel sim-entra">
          <div className="sim-panel-cab">
            <h2><Icono nombre="tienda" tam={20} /> Catálogo del Marketplace</h2>
            <small>{productos ? `${productos.length} productos` : ''}</small>
          </div>
          <div className="sim-panel-cuerpo" style={{ display: 'grid', gap: 16 }}>
            <div className="sim-filtros" role="group" aria-label="Categoría">
              {categorias.map((c) => (
                <button key={c} type="button" className="sim-filtro" aria-pressed={categoria === c} onClick={() => setCategoria(c)}>{c}</button>
              ))}
            </div>
            {!productos ? (
              <div className="sim-productos">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sim-esqueleto" style={{ height: 150 }} />)}</div>
            ) : (
              <div className="sim-productos">
                {visibles.map((p) => {
                  const n = cantidades[p.sku] ?? 0
                  return (
                    <article key={p.sku} className={`sim-producto${n > 0 ? ' sim-producto--elegido' : ''}`}>
                      <span className="sim-icono"><Icono nombre="caja" tam={20} /></span>
                      <div>
                        <h3>{p.descripcion}</h3>
                        <small>{p.sku} · {p.categoria}</small>
                      </div>
                      <div className="sim-precio">{bs(p.precio)}</div>
                      <div className="sim-paso" role="group" aria-label={`Unidades de ${p.descripcion}`}>
                        <button type="button" onClick={() => cambiar(p.sku, -1)} disabled={n === 0} aria-label="Quitar una unidad">−</button>
                        <output>{n}</output>
                        <button type="button" onClick={() => cambiar(p.sku, 1)} disabled={n >= MAX} aria-label="Agregar una unidad">+</button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        <form className="sim-panel sim-carrito sim-entra" onSubmit={enviar}>
          <div className="sim-panel-cab">
            <h2><Icono nombre="factura" tam={20} /> Pedido del cliente</h2>
            <span className="sim-contador">{unidades}</span>
          </div>
          <div className="sim-panel-cuerpo">
            {lineas.length === 0 ? (
              <div className="sim-vacio" style={{ padding: '18px 8px' }}>
                <span><Icono nombre="tienda" tam={24} /></span>
                <b>El pedido está vacío</b>
                Elige productos del catálogo con los botones + y −.
              </div>
            ) : (
              <div>
                {lineas.map((l) => (
                  <div key={l.sku} className="sim-carrito-linea">
                    <span>{l.cantidad} × {l.descripcion}</span>
                    <b style={{ fontVariantNumeric: 'tabular-nums' }}>{bs(l.cantidad * l.precio)}</b>
                  </div>
                ))}
              </div>
            )}
            <div className="sim-total"><span>Total del pedido</span><b>{bs(total)}</b></div>

            <div style={{ display: 'grid', gap: 12 }}>
              <div className="sim-campos">
                <label className="sim-campo"><span>NIT o CI</span><input className="sim-entrada" inputMode="numeric" value={cliente.nit} onChange={(e) => setCliente({ ...cliente, nit: e.target.value.replace(/\D/g, '').slice(0, 12) })} placeholder="10 dígitos" required /></label>
                <label className="sim-campo"><span>Cliente</span><input className="sim-entrada" value={cliente.razon_social} onChange={(e) => setCliente({ ...cliente, razon_social: e.target.value })} placeholder="Nombre o razón social" required /></label>
              </div>
              <label className="sim-campo"><span>Correo (opcional, para la factura digital)</span><input className="sim-entrada" type="email" value={cliente.email} onChange={(e) => setCliente({ ...cliente, email: e.target.value })} placeholder="cliente@correo.com" /></label>
              <div className="sim-campo">
                <span>Método de pago</span>
                <div className="sim-segmentos" role="group" aria-label="Método de pago">
                  {METODOS.map((m) => (
                    <button key={m.valor} type="button" aria-pressed={metodo === m.valor} onClick={() => setMetodo(m.valor)}><Icono nombre={m.icono} tam={16} /> {m.valor}</button>
                  ))}
                </div>
              </div>
              <button type="button" className="sim-btn sim-btn--claro" onClick={() => setCliente({ nit: '1023456789', razon_social: 'María Fernanda Quispe', email: '' })}>
                <Icono nombre="usuario" tam={16} /> Usar un cliente de ejemplo
              </button>
            </div>

            <div className="sim-aviso sim-aviso--warn" style={{ margin: '14px 0' }}>
              Cada venta enviada se factura <strong>de verdad</strong> en Pagos y Facturación (y su asiento viaja a Contabilidad).
            </div>
            <button type="submit" className="sim-btn sim-btn--grande sim-btn--bloque" disabled={enviando || lineas.length === 0}>
              <Icono nombre={enviando ? 'recargar' : 'enviar'} tam={19} className={enviando ? 'sim-giro' : undefined} />
              {enviando ? 'Publicando en Pub/Sub…' : 'Enviar venta al grupo A1'}
            </button>
          </div>
        </form>
      </div>

      <section className="sim-panel sim-entra">
        <div className="sim-panel-cab">
          <h2><Icono nombre="bandeja" tam={20} /> Ventas recibidas por Pagos y Facturación</h2>
          <span className="sim-chip sim-chip--info">{ventas ? `${ventas.length} últimas` : '…'}</span>
        </div>
        <div className="sim-panel-cuerpo">
          {esperando && !ventaRecibida && (
            <div className="sim-aviso sim-aviso--info" style={{ marginBottom: 12 }}>
              <span className="sim-chip sim-chip--warn sim-chip--espera"><i /> Esperando a A1</span> La venta <b>{esperando.orden_id}</b> ya está en Pub/Sub; en unos segundos aparecerá aquí.
            </div>
          )}
          {ventas && ventas.length === 0 ? (
            <div className="sim-vacio"><span><Icono nombre="bandeja" tam={26} /></span><b>Sin ventas online todavía</b>Envía el primer pedido desde el catálogo.</div>
          ) : (
            <div className="sim-tabla-scroll">
              <table className="sim-tabla">
                <thead><tr><th>Orden</th><th>Cliente</th><th>Método</th><th className="sim-num">Productos</th><th className="sim-num">Total</th><th>Recibida</th><th>Estado</th></tr></thead>
                <tbody>
                  {(ventas ?? []).map((v) => (
                    <tr key={v.orden_id} style={esperando?.orden_id === v.orden_id ? { background: 'var(--sim-claro)' } : undefined}>
                      <td><b>{v.orden_id}</b></td>
                      <td>{v.razon_social ?? '—'}</td>
                      <td>{v.metodo_pago}</td>
                      <td className="sim-num">{numero(v.productos)}</td>
                      <td className="sim-num"><b>{bs(v.total)}</b></td>
                      <td>{hace(v.recibida_en)}</td>
                      <td>{v.numero_factura ? <span className="sim-chip sim-chip--ok"><Icono nombre="check" tam={13} /> Facturada {v.numero_factura}</span> : <span className="sim-chip sim-chip--warn">Recibida · sin factura</span>}</td>
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

export default function VistaMarketplace() {
  return (
    <MarcoSimulacion vista="marketplace" letra="E" titulo="Marketplace y Ventas" volverA="/admin/ventas-online">
      {({ token }) => <Contenido token={token} />}
    </MarcoSimulacion>
  )
}
