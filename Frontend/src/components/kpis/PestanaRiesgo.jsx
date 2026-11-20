import { Aviso, Esqueleto, Vacio } from '../ui/Aviso.jsx'
import { PuntoSemaforo } from './TarjetaKPI.jsx'
import { bs, numero, porcentaje } from '../../utils/formato.js'

const COLORES_MOTIVO = ['#c53030', '#d69e2e', '#315a91', '#7898c8', '#6b46c1', '#12805c']

/** Tarjeta grande de un KPI de riesgo: titulo con valor, detalle y estado (VERDE / AMARILLO / ROJO). `children` = barra semaforo. */
export function TarjetaRiesgo({ titulo, valor, detalle, color, children }) {
  return (
    <div className={`vxp-card kpi-tarjeta--${color ?? 'gris'}`} style={{ margin: 0, position: 'relative', overflow: 'hidden' }}>
      <span style={{ position: 'absolute', inset: '0 0 auto', height: 4, background: 'var(--c, var(--kpi-gris))' }} />
      <div className="vxp-fila vxp-fila--entre">
        <h3 style={{ margin: 0, fontSize: '1.02rem' }}>{titulo}</h3>
        <PuntoSemaforo color={color} />
      </div>
      <div className="kpi-tarjeta-valor" style={{ fontSize: '2.2rem', margin: '0.5rem 0 0.2rem' }}>
        {valor}
      </div>
      <div style={{ fontSize: '0.9rem', color: 'var(--vxp-texto-suave)', fontWeight: 600 }}>
        {detalle} · <span className={color ? `kpi-texto--${color}` : undefined}>{color ?? 'SIN DATOS'}</span>
      </div>
      {children}
    </div>
  )
}

/** TDSI-153: "Anulaciones por cajero": Cajero · Anuladas · %, de mayor a menor, con una mini barra del %. */
function AnulacionesPorCajero({ datos }) {
  if (!datos) return <Esqueleto filas={4} alto={22} />
  if (datos.cajeros.length === 0) return <Vacio icono="checkCirculo" titulo="Sin anulaciones">Ningún cajero anuló facturas en el periodo.</Vacio>
  return (
    <div className="vxp-tabla-envoltura">
      <table className="vxp-tabla">
        <thead>
          <tr>
            <th>Cajero</th>
            <th className="num">Anuladas</th>
            <th className="num" style={{ width: '40%' }}>%</th>
          </tr>
        </thead>
        <tbody>
          {datos.cajeros.map((c, i) => (
            <tr key={c.cajero}>
              <td style={{ fontWeight: 600 }}>
                {i === 0 && <span className="vxp-badge vxp-badge--bad vxp-badge--sin-punto" style={{ marginRight: 6, fontSize: '0.62rem' }}>MÁS</span>}
                {c.cajero}
              </td>
              <td className="num vxp-monto">{numero(c.anuladas)}</td>
              <td className="num">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                  <div style={{ flex: 1, maxWidth: 140, height: 6, borderRadius: 99, background: '#eef1f6', overflow: 'hidden' }}>
                    <div style={{ width: `${c.porcentaje}%`, height: '100%', borderRadius: 99, background: 'linear-gradient(90deg,#e53e3e,#c53030)', transformOrigin: 'left', animation: 'kpi-crece 600ms var(--vxp-ease) both' }} />
                  </div>
                  <span style={{ minWidth: 58, fontWeight: 700 }}>{porcentaje(c.porcentaje)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** TDSI-154: "Motivos de devolución": barras horizontales con el % de cada motivo, de mayor a menor. */
function MotivosDevolucion({ devoluciones }) {
  if (!devoluciones) return <Esqueleto filas={4} alto={22} />
  if (!devoluciones.disponible) return <Aviso tono="warn" titulo="Devoluciones no respondió">{devoluciones.error}</Aviso>
  const motivos = [...(devoluciones.motivos ?? [])].sort((a, b) => b.porcentaje - a.porcentaje)
  if (motivos.length === 0) return <Vacio icono="devolucion" titulo="Sin devoluciones">No hubo devoluciones procesadas en el periodo.</Vacio>
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {motivos.map((m, i) => (
        <div key={m.motivo}>
          <div className="vxp-fila vxp-fila--entre" style={{ marginBottom: 6, fontSize: '0.88rem' }}>
            <span style={{ fontWeight: 650, color: 'var(--vx-navy)' }}>{m.motivo}</span>
            <span>
              <strong style={{ color: 'var(--vx-navy)' }}>{porcentaje(m.porcentaje, m.porcentaje % 1 ? 1 : 0)}</strong>
              <span className="vxp-texto-suave" style={{ fontSize: '0.78rem' }}> · {m.cantidad} · {bs(m.monto)}</span>
            </span>
          </div>
          <div style={{ height: 12, borderRadius: 99, background: '#eef1f6', overflow: 'hidden' }}>
            <div
              style={{
                width: `${m.porcentaje}%`,
                height: '100%',
                borderRadius: 99,
                background: COLORES_MOTIVO[i % COLORES_MOTIVO.length],
                transformOrigin: 'left',
                animation: `kpi-crece 700ms var(--vxp-ease) ${i * 70}ms both`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * TDSI-147: pestaña Riesgo: arriba "Tasa de anulación" y "Tasa de devoluciones" lado a lado (TDSI-152); abajo a la izquierda
 * "Anulaciones por cajero" (TDSI-153) y a la derecha "Motivos de devolución" (TDSI-154). `barra(kpi)` dibuja la barra semaforo.
 */
function PestanaRiesgo({ riesgo, porCajero, cargando, barra }) {
  if (cargando && !riesgo) {
    return (
      <div className="vxp-grid vxp-grid--2">
        <div className="vxp-card" style={{ margin: 0 }}>
          <Esqueleto filas={4} />
        </div>
        <div className="vxp-card" style={{ margin: 0 }}>
          <Esqueleto filas={4} />
        </div>
      </div>
    )
  }
  if (!riesgo) return <Aviso tono="warn" titulo="No se pudo cargar la pestaña Riesgo" />
  const a = riesgo.anulacion
  const d = riesgo.devoluciones
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="vxp-grid vxp-grid--2 vxp-escalon">
        <TarjetaRiesgo titulo="Tasa de anulación" valor={porcentaje(a.valor)} detalle={`${numero(a.anuladas)} de ${numero(a.emitidas)} facturas`} color={a.color}>
          {barra?.({ ...a, indicador: 'tasa_anulacion', unidad: '%' })}
        </TarjetaRiesgo>
        <TarjetaRiesgo
          titulo="Tasa de devoluciones"
          valor={d.disponible ? porcentaje(d.valor) : '—'}
          detalle={d.disponible ? `${bs(d.monto_devuelto)} devueltos` : 'Devoluciones no respondió'}
          color={d.color}
        >
          {d.disponible && barra?.({ ...d, indicador: 'tasa_devoluciones', unidad: '%' })}
        </TarjetaRiesgo>
      </div>
      <div className="vxp-grid vxp-grid--2">
        <div className="vxp-card" style={{ margin: 0 }}>
          <h3 className="vxp-card-titulo">
            Anulaciones por cajero
            {porCajero && <small>{numero(porCajero.total_anuladas)} anuladas</small>}
          </h3>
          <AnulacionesPorCajero datos={porCajero} />
        </div>
        <div className="vxp-card" style={{ margin: 0 }}>
          <h3 className="vxp-card-titulo">
            Motivos de devolución
            {d.disponible && <small>{numero(d.cantidad ?? 0)} devoluciones</small>}
          </h3>
          <MotivosDevolucion devoluciones={d} />
        </div>
      </div>
    </div>
  )
}

export default PestanaRiesgo
