import Icono from './Icono.jsx'

/**
 * Boton premium de Vortrix. Variantes: primario (azul), negro, exito, peligro, oro, claro, fantasma, vidrio.
 * Al cargar, el texto se difumina y aparece un spinner sin cambiar el ancho del boton.
 *   <Boton variante="exito" icono="check" cargando={enviando}>Aprobar</Boton>
 */
function Boton({
  variante = 'primario',
  tam,
  icono,
  iconoFinal,
  cargando = false,
  bloque = false,
  className = '',
  children,
  type = 'button',
  disabled,
  ...resto
}) {
  const clases = [
    'vxp-btn',
    variante !== 'primario' && `vxp-btn--${variante}`,
    tam && `vxp-btn--${tam}`,
    bloque && 'vxp-btn--bloque',
    cargando && 'vxp-btn--cargando',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const tamIcono = tam === 'sm' ? 15 : 17

  return (
    <button type={type} className={clases} disabled={disabled || cargando} aria-busy={cargando || undefined} {...resto}>
      <span className="vxp-btn-contenido">
        {icono && <Icono nombre={icono} tam={tamIcono} />}
        {children}
        {iconoFinal && <Icono nombre={iconoFinal} tam={tamIcono} />}
      </span>
      {cargando && (
        <span className="vxp-btn-spinner" aria-hidden="true">
          <span className="vxp-spinner" />
        </span>
      )}
    </button>
  )
}

export default Boton
