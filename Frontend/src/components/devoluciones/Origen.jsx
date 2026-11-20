import Icono from '../ui/Icono.jsx'

/** TDSI-119: etiqueta "Marketplace" con el numero de orden en las devoluciones que vienen de pedidos online. */
export function EtiquetaMarketplace({ devolucion }) {
  if (devolucion.origen !== 'MARKETPLACE') return null
  return (
    <div style={{ marginTop: 4 }}>
      <span
        className="vxp-badge vxp-badge--sin-punto"
        style={{ '--i-c': '#c05621', '--i-bg': '#fff1e6', fontSize: '0.68rem', gap: 4 }}
        title="Solicitud recibida desde el Marketplace"
      >
        <Icono nombre="globo" tam={12} />
        Marketplace{devolucion.orden_id ? ` · ${devolucion.orden_id}` : ''}
      </span>
    </div>
  )
}

export const ORIGENES = [
  { id: '', etiqueta: 'Todos', icono: 'lista' },
  { id: 'TIENDA', etiqueta: 'Tienda', icono: 'tienda' },
  { id: 'MARKETPLACE', etiqueta: 'Marketplace', icono: 'globo' },
]

/** TDSI-120: filtro "Origen: Tienda / Marketplace" como selector segmentado. */
export function FiltroOrigen({ valor, onCambiar, compacto = false }) {
  return (
    <div className="vxp-segmentos" role="radiogroup" aria-label="Origen" style={compacto ? { padding: 3 } : undefined}>
      {ORIGENES.map((o) => (
        <button
          key={o.id || 'todos'}
          type="button"
          role="radio"
          aria-checked={valor === o.id}
          className={`vxp-segmento${valor === o.id ? ' vxp-segmento--activo' : ''}`}
          style={compacto ? { padding: '0.35rem 0.65rem', fontSize: '0.78rem' } : undefined}
          onClick={() => onCambiar(o.id)}
        >
          <Icono nombre={o.icono} tam={14} />
          {o.etiqueta}
        </button>
      ))}
    </div>
  )
}
