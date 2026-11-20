import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { bs, fecha } from '../../utils/formato.js'

const ALTO = 260
const M = { arriba: 16, derecha: 18, abajo: 30, izquierda: 56 }

/** Redondea hacia arriba a un numero "lindo" para el eje (1, 2, 2.5, 5 x 10^n). */
function techoLindo(v) {
  if (v <= 0) return 100
  const p = 10 ** Math.floor(Math.log10(v))
  const n = v / p
  const paso = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return paso * p
}

const corto = (n) => (n >= 1000 ? `${(n / 1000).toLocaleString('es-BO', { maximumFractionDigits: 1 })}k` : n.toLocaleString('es-BO'))
const diaCorto = (iso) => {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/**
 * TDSI-143: "Ventas diarias vs meta (últimos 30 días)": linea con las ventas de cada dia y una linea roja horizontal con la meta.
 * SVG propio (sin librerias), ancho fluido, tooltip con cruz al pasar el puntero o con el teclado (flechas).
 */
function GraficoVentasMeta({ serie = [], metaDiaria = null }) {
  const contRef = useRef(null)
  const [ancho, setAncho] = useState(640)
  const [foco, setFoco] = useState(null)
  const lineaRef = useRef(null)
  const [largo, setLargo] = useState(0)

  useLayoutEffect(() => {
    const el = contRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { puntos, y, yMax, ticks, xDe } = useMemo(() => {
    const max = Math.max(metaDiaria ?? 0, ...serie.map((s) => s.ventas), 1)
    const top = techoLindo(max * 1.08)
    const anchoUtil = ancho - M.izquierda - M.derecha
    const altoUtil = ALTO - M.arriba - M.abajo
    const xDeF = (i) => M.izquierda + (serie.length <= 1 ? anchoUtil / 2 : (i / (serie.length - 1)) * anchoUtil)
    const yF = (v) => M.arriba + altoUtil - (v / top) * altoUtil
    return {
      puntos: serie.map((s, i) => [xDeF(i), yF(s.ventas)]),
      y: yF,
      yMax: top,
      ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => f * top),
      xDe: xDeF,
    }
  }, [serie, metaDiaria, ancho])

  const d = puntos.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const area = puntos.length ? `${d} L${puntos[puntos.length - 1][0].toFixed(1)},${y(0)} L${puntos[0][0].toFixed(1)},${y(0)} Z` : ''

  useEffect(() => {
    if (lineaRef.current) setLargo(Math.ceil(lineaRef.current.getTotalLength()))
  }, [d])

  function alMover(e) {
    if (!serie.length) return
    const r = contRef.current.getBoundingClientRect()
    const x = e.clientX - r.left
    let mejor = 0
    for (let i = 1; i < puntos.length; i += 1) if (Math.abs(puntos[i][0] - x) < Math.abs(puntos[mejor][0] - x)) mejor = i
    setFoco(mejor)
  }

  function alTeclear(e) {
    if (!serie.length) return
    if (e.key === 'ArrowRight') setFoco((f) => Math.min(serie.length - 1, (f ?? -1) + 1))
    else if (e.key === 'ArrowLeft') setFoco((f) => Math.max(0, (f ?? serie.length) - 1))
    else if (e.key === 'Escape') setFoco(null)
  }

  const etiquetasX = serie.map((s, i) => ({ i, texto: diaCorto(s.fecha) })).filter(({ i }) => i % Math.ceil(serie.length / Math.max(2, Math.floor(ancho / 70))) === 0 || i === serie.length - 1)
  const punto = foco !== null ? serie[foco] : null
  const sobreMeta = punto && metaDiaria !== null ? punto.ventas >= metaDiaria : null

  return (
    <div className="kpi-grafico" ref={contRef}>
      <svg
        height={ALTO}
        viewBox={`0 0 ${ancho} ${ALTO}`}
        role="img"
        aria-label={`Ventas diarias de los últimos ${serie.length} días${metaDiaria !== null ? ` contra una meta diaria de ${bs(metaDiaria)}` : ''}`}
        tabIndex={0}
        onMouseMove={alMover}
        onMouseLeave={() => setFoco(null)}
        onKeyDown={alTeclear}
        onBlur={() => setFoco(null)}
        style={{ outline: 'none' }}
      >
        <defs>
          <linearGradient id="kpi-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#315a91" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#315a91" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.izquierda} x2={ancho - M.derecha} y1={y(t)} y2={y(t)} stroke="#e8edf4" strokeDasharray={t === 0 ? undefined : '3 4'} />
            <text x={M.izquierda - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="#8a929e">
              {corto(t)}
            </text>
          </g>
        ))}
        {etiquetasX.map(({ i, texto }) => (
          <text key={i} x={xDe(i)} y={ALTO - 8} textAnchor="middle" fontSize="11" fill="#8a929e">
            {texto}
          </text>
        ))}

        {area && <path className="kpi-grafico-area" d={area} fill="url(#kpi-area)" />}
        {d && (
          <path
            ref={lineaRef}
            className={largo ? 'kpi-grafico-linea' : undefined}
            style={largo ? { '--largo': largo } : { opacity: 0 }}
            d={d}
            fill="none"
            stroke="#1d3f73"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* linea roja de la meta */}
        {metaDiaria !== null && (
          <g>
            <line x1={M.izquierda} x2={ancho - M.derecha} y1={y(metaDiaria)} y2={y(metaDiaria)} stroke="#e53e3e" strokeWidth="2" strokeDasharray="7 5" />
            <rect x={ancho - M.derecha - 92} y={y(metaDiaria) - 22} width="92" height="18" rx="6" fill="#e53e3e" />
            <text x={ancho - M.derecha - 46} y={y(metaDiaria) - 13} dy="0.32em" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#fff">
              Meta {corto(metaDiaria)}
            </text>
          </g>
        )}

        {punto && (
          <g>
            <line x1={puntos[foco][0]} x2={puntos[foco][0]} y1={M.arriba} y2={y(0)} stroke="#06152f" strokeOpacity="0.25" />
            <circle cx={puntos[foco][0]} cy={puntos[foco][1]} r="5.5" fill="#fff" stroke={sobreMeta === false ? '#e53e3e' : '#12805c'} strokeWidth="3" />
          </g>
        )}
      </svg>

      {punto && (
        <div className="kpi-tooltip" style={{ left: puntos[foco][0], top: puntos[foco][1] }}>
          <span style={{ color: 'rgba(255,255,255,.65)' }}>{fecha(`${punto.fecha}T12:00:00-04:00`)}</span>
          <strong>{bs(punto.ventas)}</strong>
          {metaDiaria !== null && (
            <span style={{ color: sobreMeta ? '#7ee2b8' : '#feb2b2', fontWeight: 600 }}>
              {sobreMeta ? 'Sobre la meta' : `Faltaron ${bs(metaDiaria - punto.ventas)}`}
            </span>
          )}
        </div>
      )}

      <div className="kpi-leyenda" style={{ marginTop: 6 }}>
        <span>
          <svg width="18" height="4" aria-hidden="true">
            <line x1="0" y1="2" x2="18" y2="2" stroke="#1d3f73" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Ventas del día
        </span>
        <span>
          <svg width="18" height="4" aria-hidden="true">
            <line x1="0" y1="2" x2="18" y2="2" stroke="#e53e3e" strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          Meta diaria {metaDiaria !== null ? bs(metaDiaria) : '(sin meta configurada)'}
        </span>
        <span style={{ marginLeft: 'auto' }}>Eje: Bs · máx. {corto(yMax)}</span>
      </div>
    </div>
  )
}

export default GraficoVentasMeta
