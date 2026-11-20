import Icono from './Icono.jsx'

const ICONO = { ok: 'checkCirculo', bad: 'alerta', warn: 'alerta', info: 'info' }

/** Aviso en linea con borde de color: <Aviso tono="bad" titulo="Fuera de plazo">La compra tiene más de 7 días.</Aviso> */
export function Aviso({ tono = 'info', titulo, children, accion }) {
  return (
    <div className={`vxp-aviso${tono !== 'info' ? ` vxp-aviso--${tono}` : ''}`} role={tono === 'bad' ? 'alert' : 'status'}>
      <Icono nombre={ICONO[tono]} tam={20} />
      <div style={{ flex: 1 }}>
        {titulo && <strong>{titulo}</strong>}
        {children}
      </div>
      {accion}
    </div>
  )
}

/** Estado vacio con icono: <Vacio icono="bandeja" titulo="Sin pendientes">No hay devoluciones por revisar.</Vacio> */
export function Vacio({ icono = 'bandeja', titulo, children, accion }) {
  return (
    <div className="vxp-vacio">
      <span className="vxp-vacio-icono">
        <Icono nombre={icono} tam={26} />
      </span>
      {titulo && <strong>{titulo}</strong>}
      {children && <div>{children}</div>}
      {accion}
    </div>
  )
}

/** Bloques grises con brillo mientras carga: <Esqueleto filas={4} /> */
export function Esqueleto({ filas = 3, alto = 18 }) {
  return (
    <div style={{ display: 'grid', gap: 10 }} aria-hidden="true">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="vxp-esqueleto" style={{ height: alto, width: `${100 - (i % 3) * 12}%` }} />
      ))}
    </div>
  )
}
