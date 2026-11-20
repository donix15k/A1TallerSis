import { Esqueleto } from '../ui/Aviso.jsx'
import Icono from '../ui/Icono.jsx'
import { PuntoSemaforo } from './TarjetaKPI.jsx'

const PESTANA_DE = {
  ticket_promedio: 'riesgo',
  tasa_anulacion: 'riesgo',
  tasa_devoluciones: 'riesgo',
  cumplimiento_metas: 'cajas',
  efectividad_cuadre: 'cajas',
  dias_pago_proveedores: 'integraciones',
  aceptacion_contable: 'integraciones',
}

/**
 * TDSI-195: cuadro "⚠ Alertas del día" a la derecha del grafico: una linea por alerta, primero las rojas y luego las amarillas.
 * Clic en una alerta = abrir la pestaña donde se ve su detalle.
 */
function AlertasDelDia({ datos, cargando, onIr }) {
  const alertas = datos?.alertas ?? []
  return (
    <div className="vxp-card" style={{ margin: 0, borderColor: alertas.length ? '#f3d9a4' : undefined, background: alertas.length ? 'linear-gradient(180deg,#fffdf7,#fff)' : undefined }}>
      <h2 className="vxp-card-titulo">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#d69e2e' }}>⚠</span> Alertas del día
        </span>
        {datos && (
          <span className="vxp-fila" style={{ gap: 6 }}>
            {datos.rojas > 0 && <span className="vxp-badge vxp-badge--bad">{datos.rojas}</span>}
            {datos.amarillas > 0 && <span className="vxp-badge vxp-badge--warn">{datos.amarillas}</span>}
          </span>
        )}
      </h2>
      {cargando && !datos ? (
        <Esqueleto filas={4} alto={18} />
      ) : alertas.length === 0 ? (
        <div className="vxp-vacio" style={{ padding: '1.2rem 0.5rem' }}>
          <span className="vxp-vacio-icono" style={{ background: 'var(--vxp-ok-bg)', color: 'var(--vxp-ok)' }}>
            <Icono nombre="checkCirculo" tam={26} />
          </span>
          <strong>Todo en orden</strong>
          <span style={{ fontSize: '0.85rem' }}>Ningún indicador está en amarillo o rojo.</span>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, maxHeight: 290, overflowY: 'auto' }}>
          {alertas.map((a, i) => (
            <li key={`${a.tipo}-${a.indicador}-${i}`} style={{ animation: `vxp-entra-arriba 280ms var(--vxp-ease) ${Math.min(i, 6) * 40}ms both` }}>
              <button
                type="button"
                onClick={() => onIr?.(PESTANA_DE[a.indicador] ?? 'resumen')}
                className="vxp-fila"
                style={{
                  width: '100%',
                  flexWrap: 'nowrap',
                  gap: 10,
                  padding: '0.55rem 0.7rem',
                  border: 0,
                  borderRadius: 10,
                  textAlign: 'left',
                  font: 'inherit',
                  fontSize: '0.86rem',
                  fontWeight: 600,
                  color: 'var(--vx-navy)',
                  background: a.nivel === 'ROJO' ? 'var(--vxp-bad-bg)' : 'var(--vxp-warn-bg)',
                  cursor: 'pointer',
                }}
              >
                <PuntoSemaforo color={a.nivel} />
                <span style={{ flex: 1 }}>{a.mensaje}</span>
                <Icono nombre="flecha" tam={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default AlertasDelDia
