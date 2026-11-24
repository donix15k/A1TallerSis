/**
 * TDSI-142: tarjeta reutilizable de un KPI: nombre, valor del mes y punto de color del semaforo (VERDE, AMARILLO o ROJO;
 * gris si no hay datos). Clic = ver su detalle (abre la pestaña correspondiente).
 */
export function PuntoSemaforo({ color, titulo }) {
  return <span className={`kpi-punto${color ? ` kpi-punto--${color}` : ''}`} role="img" aria-label={titulo ?? (color ? `Semáforo ${color}` : 'Sin datos')} title={color ?? 'Sin datos'} />
}

function TarjetaKPI({ nombre, valor, color, detalle, cargando = false, onClick, ayuda }) {
  return (
    <button type="button" className={`kpi-tarjeta${color ? ` kpi-tarjeta--${color}` : ''}`} onClick={onClick} aria-label={`${nombre}: ${valor ?? 'sin datos'}. ${ayuda ?? ''} Clic para ver cómo se calculó.`}>
      <span className="kpi-tarjeta-nombre">
        {nombre}
        {!cargando && <PuntoSemaforo color={color} />}
      </span>
      {cargando ? (
        <>
          <span className="vxp-esqueleto" style={{ height: 28, width: '70%' }} />
          <span className="vxp-esqueleto" style={{ height: 12, width: '50%', marginTop: 'auto' }} />
        </>
      ) : (
        <>
          <span className="kpi-tarjeta-valor">{valor ?? '—'}</span>
          <span className="kpi-tarjeta-detalle">{detalle ?? (color ? color : 'Sin datos')}</span>
        </>
      )}
      {ayuda && !cargando && (
        <span className="kpi-tip" role="tooltip">
          <b>{nombre}</b>
          {ayuda}
          <em>Clic para ver cómo se calculó</em>
        </span>
      )}
    </button>
  )
}

export default TarjetaKPI
