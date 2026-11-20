import { Aviso, Esqueleto, Vacio } from '../ui/Aviso.jsx'
import Icono from '../ui/Icono.jsx'
import { PuntoSemaforo } from './TarjetaKPI.jsx'
import { bs, fechaHora, numero } from '../../utils/formato.js'

const TONO_TIPO = { CUADRA: 'ok', SOBRANTE: 'warn', FALTANTE: 'bad' }

/** Diferencia con signo: -Bs 22,00 / +Bs 5,00 */
const conSigno = (n) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${bs(Math.abs(n))}`

/** TDSI-172: tarjeta de fondo crema "Efectividad de cuadre": %, X de Y turnos cuadran, sobrantes, faltantes y "Estado". */
export function TarjetaEfectividadCuadre({ cuadre }) {
  return (
    <div
      className={`vxp-card kpi-tarjeta--${cuadre.color ?? 'gris'}`}
      style={{ margin: 0, background: 'linear-gradient(180deg,#fffaf0 0%,#fdf3dc 100%)', borderColor: '#f1e2bb', position: 'relative', overflow: 'hidden' }}
    >
      <span style={{ position: 'absolute', inset: '0 0 auto', height: 4, background: 'var(--c, var(--kpi-gris))' }} />
      <div className="vxp-fila vxp-fila--entre">
        <h3 style={{ margin: 0, fontSize: '1.02rem' }}>Efectividad de cuadre</h3>
        <PuntoSemaforo color={cuadre.color} />
      </div>
      {cuadre.sin_turnos ? (
        <p className="vxp-texto-suave" style={{ margin: '1rem 0 0' }}>No hay turnos cerrados con arqueo en el periodo.</p>
      ) : (
        <>
          <div className="kpi-tarjeta-valor" style={{ fontSize: '2.4rem', margin: '0.45rem 0 0.1rem' }}>
            {numero(cuadre.porcentaje, 1)} %
          </div>
          <div style={{ fontWeight: 650, color: 'var(--vx-navy)' }}>
            {numero(cuadre.turnos_cuadran)} de {numero(cuadre.turnos_cerrados)} turnos cuadran
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '1rem 0 0.8rem' }}>
            <div style={{ padding: '0.6rem 0.75rem', borderRadius: 10, background: 'rgba(255,255,255,.7)' }}>
              <dt style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#a6741b' }}>Sobrantes</dt>
              <dd className="vxp-monto" style={{ margin: 0, color: 'var(--vx-navy)' }}>{bs(cuadre.sobrantes)}</dd>
            </div>
            <div style={{ padding: '0.6rem 0.75rem', borderRadius: 10, background: 'rgba(255,255,255,.7)' }}>
              <dt style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--kpi-rojo)' }}>Faltantes</dt>
              <dd className="vxp-monto" style={{ margin: 0, color: 'var(--vx-navy)' }}>{bs(cuadre.faltantes)}</dd>
            </div>
          </dl>
          <div style={{ fontWeight: 750 }}>
            Estado: <span className={cuadre.color ? `kpi-texto--${cuadre.color}` : undefined}>{cuadre.color ?? '—'}</span>
          </div>
        </>
      )}
    </div>
  )
}

/** TDSI-173: "Turnos con diferencia": Turno · Caja · Cajero · diferencia · FALTANTE/SOBRANTE (la mayor primero). */
export function TurnosConDiferencia({ turnos }) {
  if (turnos.length === 0) return <Vacio icono="checkCirculo" titulo="Todos los turnos cuadraron">Ningún turno del periodo tuvo diferencia.</Vacio>
  return (
    <div className="vxp-tabla-envoltura" style={{ maxHeight: 340, overflowY: 'auto' }}>
      <table className="vxp-tabla">
        <thead>
          <tr>
            <th>Turno</th>
            <th>Caja</th>
            <th>Cajero</th>
            <th className="num">Diferencia</th>
            <th>Tipo</th>
          </tr>
        </thead>
        <tbody>
          {turnos.map((t) => (
            <tr key={t.turno_id}>
              <td className="vxp-codigo">Turno {t.turno ?? t.turno_id}</td>
              <td>{t.caja_nombre}</td>
              <td style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.cajero}>{t.cajero}</td>
              <td className="num vxp-monto" style={{ color: t.tipo === 'FALTANTE' ? 'var(--kpi-rojo)' : '#a6741b' }}>{conSigno(t.diferencia)}</td>
              <td>
                <span className={`vxp-badge vxp-badge--${TONO_TIPO[t.tipo] ?? 'neutro'}`}>{t.tipo}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Fila de abajo de la pestaña Cajas: Efectividad de cuadre (izquierda) y Turnos con diferencia (derecha). */
export function SeccionCuadre({ cuadre, cargando }) {
  if (cargando && !cuadre) {
    return (
      <div className="vxp-grid vxp-grid--2">
        <div className="vxp-card" style={{ margin: 0 }}>
          <Esqueleto filas={5} />
        </div>
        <div className="vxp-card" style={{ margin: 0 }}>
          <Esqueleto filas={5} />
        </div>
      </div>
    )
  }
  if (!cuadre) return <Aviso tono="warn" titulo="No se pudo cargar el cuadre de caja" />
  return (
    <div className="vxp-grid vxp-grid--2" style={{ alignItems: 'start' }}>
      <TarjetaEfectividadCuadre cuadre={cuadre} />
      <div className="vxp-card" style={{ margin: 0 }}>
        <h3 className="vxp-card-titulo">
          Turnos con diferencia
          <small>{cuadre.turnos_con_diferencia.length}</small>
        </h3>
        <TurnosConDiferencia turnos={cuadre.turnos_con_diferencia} />
      </div>
    </div>
  )
}

/** TDSI-174: franja "Últimos turnos cerrados" del Resumen: cada turno con su caja y si CUADRA o tiene FALTANTE/SOBRANTE con su monto. */
export function UltimosTurnosCerrados({ turnos, cargando }) {
  return (
    <div className="vxp-card" style={{ marginTop: '1rem' }}>
      <h3 className="vxp-card-titulo" style={{ marginBottom: '0.75rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icono nombre="reloj" tam={18} /> Últimos turnos cerrados
        </span>
      </h3>
      {cargando && !turnos ? (
        <Esqueleto filas={1} alto={44} />
      ) : !turnos || turnos.length === 0 ? (
        <span className="vxp-texto-suave">No hay turnos cerrados en el periodo.</span>
      ) : (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
          {turnos.map((t, i) => (
            <div
              key={t.turno_id}
              className="vxp-dato"
              style={{ flex: '0 0 auto', minWidth: 190, animation: `vxp-entra-arriba 300ms var(--vxp-ease) ${i * 45}ms both` }}
              title={fechaHora(t.cerrado_en)}
            >
              <div style={{ fontWeight: 700, color: 'var(--vx-navy)' }}>
                Turno {t.turno ?? t.turno_id} · {t.caja_nombre}
              </div>
              <span className={`vxp-badge vxp-badge--${TONO_TIPO[t.tipo] ?? 'neutro'}`} style={{ marginTop: 6 }}>
                {t.tipo === 'CUADRA' ? 'CUADRA' : `${t.tipo} ${bs(Math.abs(t.diferencia))}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
