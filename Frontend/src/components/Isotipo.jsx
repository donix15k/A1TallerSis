import './Marca.css'

// Isotipo de Vortrix armado con sus 3 piezas por separado (capas PNG con el mismo
// lienzo) para poder animarlas: "armar" las hace entrar una por una (splash) y "pulso"
// las enciende en secuencia (pantallas de carga). Sin animacion es una imagen estatica.
// El tamaño se controla con la variable CSS --vx-iso-w (ancho); el alto sale de la proporcion.
function Isotipo({ animacion = 'ninguna', className = '' }) {
  return (
    <span className={`vx-isotipo vx-isotipo--${animacion} ${className}`.trim()} aria-hidden="true">
      <img className="vx-isotipo-pieza vx-isotipo-pieza--izq" src="/brand/isotipo-left.png" alt="" draggable="false" />
      <img className="vx-isotipo-pieza vx-isotipo-pieza--ala" src="/brand/isotipo-wing.png" alt="" draggable="false" />
      <img className="vx-isotipo-pieza vx-isotipo-pieza--azul" src="/brand/isotipo-blue.png" alt="" draggable="false" />
    </span>
  )
}

export default Isotipo
