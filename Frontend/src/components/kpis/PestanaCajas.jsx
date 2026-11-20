import { Aviso, Esqueleto, Vacio } from '../ui/Aviso.jsx'
import Icono from '../ui/Icono.jsx'
import { PuntoSemaforo } from './TarjetaKPI.jsx'
import { bs, numero } from '../../utils/formato.js'

const COLOR_BARRA = {
  VERDE: 'linear-gradient(90deg,#19a874,#12805c)',
  AMARILLO: 'linear-gradient(90deg,#f0c24b,#d69e2e)',
  ROJO: 'linear-gradient(90deg,#f56565,#c53030)',
}

/**
 * TDSI-162/163: tarjeta de una caja: "Caja N · %", "Vendido Bs" y "Meta Bs", y la barra de avance pintada con el color del
 * semaforo. Si paso la meta, la barra se llena y aparece un sello con el excedente.
 */
function TarjetaCaja({ caja, indice }) {
  const pct = caja.porcentaje
  const ancho = pct === null ? 0 : Math.min(100, pct)
  const nombre = caja.caja_nombre || caja.caja_id
  return (
    <div className={`vxp-card kpi-tarjeta--${caja.color ?? 'gris'}`} style={{ margin: 0, position: 'relative', overflow: 'hidden', animation: `vxp-entra-arriba 320ms var(--vxp-ease) ${indice * 50}ms both` }}>
      <span style={{ position: 'absolute', inset: '0 0 auto', height: 4, background: 'var(--c, var(--kpi-gris))' }} />
      <div className="vxp-fila vxp-fila--entre">
        <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', color: 'var(--vx-navy)' }}>
          {nombre} · <span className={caja.color ? `kpi-texto--${caja.color}` : undefined}>{pct === null ? 'sin meta' : `${numero(pct, pct % 1 ? 1 : 0)} %`}</span>
        </strong>
        {/* TDSI-193: estado en texto junto al punto */}
        <span className="vxp-fila" style={{ gap: 6, fontSize: '0.72rem', fontWeight: 800 }}>
          <span className={caja.color ? `kpi-texto--${caja.color}` : 'vxp-texto-suave'}>{caja.color ?? 'SIN META'}</span>
          <PuntoSemaforo color={caja.color} />
        </span>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '0.8rem 0' }}>
        <div>
          <dt style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--vxp-texto-suave)' }}>Vendido</dt>
          <dd className="vxp-monto" style={{ margin: 0, color: 'var(--vx-navy)' }}>{bs(caja.vendido)}</dd>
        </div>
        <div>
          <dt style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--vxp-texto-suave)' }}>Meta</dt>
          <dd className="vxp-monto" style={{ margin: 0, color: 'var(--vx-navy)' }}>{caja.meta === null ? '—' : bs(caja.meta)}</dd>
        </div>
      </dl>
      <div
        role="progressbar"
        aria-label={`Avance de ${nombre}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ancho)}
        style={{ position: 'relative', height: 12, borderRadius: 99, background: '#eef1f6', overflow: 'hidden' }}
      >
        <div
          style={{
            width: `${ancho}%`,
            height: '100%',
            borderRadius: 99,
            background: COLOR_BARRA[caja.color] ?? '#c5cbd4',
            transformOrigin: 'left',
            animation: `kpi-crece 800ms var(--vxp-ease) ${120 + indice * 60}ms both`,
          }}
        />
      </div>
      <div className="vxp-fila vxp-fila--entre" style={{ marginTop: 6, fontSize: '0.76rem', color: 'var(--vxp-texto-suave)' }}>
        <span>{caja.meta === null ? 'Configure su meta en "Configurar objetivos"' : pct >= 100 ? `Superó la meta por ${bs(caja.vendido - caja.meta)}` : `Faltan ${bs(caja.meta - caja.vendido)}`}</span>
        {pct >= 100 && (
          <span className="vxp-badge vxp-badge--ok vxp-badge--sin-punto" style={{ fontSize: '0.66rem' }}>
            <Icono nombre="check" tam={11} trazo={3} /> META
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * TDSI-158: pestaña Cajas. Arriba una tarjeta por caja (TDSI-162/163); `abajo` = las tarjetas de cuadre de caja (TDSI-168).
 */
function PestanaCajas({ metas, cargando, abajo }) {
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {cargando && !metas ? (
        <div className="vxp-grid vxp-grid--3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="vxp-card" style={{ margin: 0 }}>
              <Esqueleto filas={3} />
            </div>
          ))}
        </div>
      ) : !metas ? (
        <Aviso tono="warn" titulo="No se pudo cargar el cumplimiento de metas" />
      ) : metas.cajas.length === 0 ? (
        <div className="vxp-card" style={{ margin: 0 }}>
          <Vacio icono="caja" titulo="Sin cajas activas" />
        </div>
      ) : (
        <>
          <div className="vxp-fila vxp-fila--entre">
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Metas por caja</h3>
            {metas.general.porcentaje !== null && (
              <span className="vxp-fila" style={{ gap: 8, fontSize: '0.86rem', fontWeight: 650, color: 'var(--vx-navy)' }}>
                General {numero(metas.general.porcentaje, metas.general.porcentaje % 1 ? 1 : 0)} % <PuntoSemaforo color={metas.general.color} />
              </span>
            )}
          </div>
          <div className="vxp-grid vxp-grid--3">
            {metas.cajas.map((c, i) => (
              <TarjetaCaja key={c.caja_id} caja={c} indice={i} />
            ))}
          </div>
        </>
      )}
      {abajo}
    </div>
  )
}

export default PestanaCajas
