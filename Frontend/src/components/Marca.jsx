import Isotipo from './Isotipo.jsx'
import './Marca.css'

// Isologo de Vortrix (isotipo + logotipo) para las barras de navegacion y cabeceras.
// "claro" = letras blancas, para fondos oscuros; "oscuro" = letras azul marino, para fondos claros.
function Marca({ tema = 'claro', sufijo = null, className = '' }) {
  return (
    <span className={`vx-marca vx-marca--${tema} ${className}`.trim()}>
      <Isotipo />
      <img
        className="vx-marca-logotipo"
        src={tema === 'claro' ? '/brand/wordmark-light.png' : '/brand/wordmark-dark.png'}
        alt="Vortrix"
        draggable="false"
      />
      {sufijo && <span className="vx-marca-sufijo">{sufijo}</span>}
    </span>
  )
}

export default Marca
