import Isotipo from './Isotipo.jsx'
import './Cargando.css'

// Indicador de carga de Vortrix: el isotipo se enciende pieza por pieza. Reemplaza al
// texto suelto "Cargando..."; conserva el texto (legible para lectores de pantalla y
// visible al lado) y se puede usar en linea dentro de cualquier pantalla.
function Cargando({ texto = 'Cargando...', className = '' }) {
  return (
    <p className={`vx-cargando ${className}`.trim()} role="status" aria-live="polite">
      <Isotipo animacion="pulso" />
      <span className="vx-cargando-texto">{texto}</span>
    </p>
  )
}

export default Cargando
