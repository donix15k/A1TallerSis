import { numero } from '../../utils/formato.js'

const COLOR = { VERDE: '#12805c', AMARILLO: '#d69e2e', ROJO: '#c53030' }

/**
 * TDSI-194: barra semaforo horizontal con tres tramos (verde, amarillo, rojo) y un triangulo negro ▼ en el valor actual.
 * Cada barra usa los limites de su propio KPI. sentido "MENOR" (anulacion, devoluciones): menos es mejor -> verde a la izquierda.
 * sentido "MAYOR" (ticket, metas, cuadre...): mas es mejor -> rojo a la izquierda.
 *   <BarraSemaforo valor={2.89} verde={2} amarillo={5} sentido="MENOR" unidad="%" />
 */
function BarraSemaforo({ valor, verde, amarillo, sentido = 'MENOR', unidad = '%' }) {
  if (valor === null || valor === undefined || verde === undefined || amarillo === undefined) return null
  const menor = sentido === 'MENOR'
  // escala: hasta un poco mas alla del limite mas alto, o del valor si lo supera
  const tope = Math.max(menor ? amarillo * 1.6 : verde * 1.25, valor * 1.08, 1)
  const pct = (v) => Math.max(0, Math.min(100, (v / tope) * 100))
  const tramos = menor
    ? [
        { desde: 0, hasta: verde, color: COLOR.VERDE },
        { desde: verde, hasta: amarillo, color: COLOR.AMARILLO },
        { desde: amarillo, hasta: tope, color: COLOR.ROJO },
      ]
    : [
        { desde: 0, hasta: amarillo, color: COLOR.ROJO },
        { desde: amarillo, hasta: verde, color: COLOR.AMARILLO },
        { desde: verde, hasta: tope, color: COLOR.VERDE },
      ]
  const posicion = pct(valor)
  const fmt = (v) => `${numero(v, v % 1 ? 1 : 0)}${unidad === '%' ? ' %' : ` ${unidad}`}`

  return (
    <div style={{ marginTop: '1.1rem' }} role="img" aria-label={`Valor actual ${fmt(valor)}; verde ${menor ? 'hasta' : 'desde'} ${fmt(verde)}, amarillo hasta ${fmt(amarillo)}`}>
      <div style={{ position: 'relative', height: 30 }}>
        {/* triangulo ▼ sobre la barra en el valor actual */}
        <div
          style={{
            position: 'absolute',
            left: `${posicion}%`,
            bottom: 2,
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            animation: 'kpi-baja 500ms var(--vxp-ease) 200ms both',
          }}
        >
          <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#0b0d12', whiteSpace: 'nowrap', marginBottom: 1 }}>{fmt(valor)}</span>
          <svg width="14" height="9" viewBox="0 0 14 9" aria-hidden="true">
            <path d="M0 0h14L7 9z" fill="#0b0d12" />
          </svg>
        </div>
      </div>
      <div style={{ display: 'flex', height: 12, borderRadius: 99, overflow: 'hidden', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.12)' }}>
        {tramos.map((t) => (
          <span key={t.color} style={{ width: `${pct(t.hasta) - pct(t.desde)}%`, background: t.color }} />
        ))}
      </div>
      <div style={{ position: 'relative', height: 16, marginTop: 3, fontSize: '0.7rem', color: 'var(--vxp-texto-suave)', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ position: 'absolute', left: 0 }}>0</span>
        {[verde, amarillo].map((l) => (
          <span key={l} style={{ position: 'absolute', left: `${pct(l)}%`, transform: 'translateX(-50%)' }}>
            {fmt(l)}
          </span>
        ))}
      </div>
    </div>
  )
}

export default BarraSemaforo
