import { useState } from 'react'

// Foto del producto: Frontend/public/productos/<SKU>.jpg (también .webp o .png), de 800 x 600 px. Si no existe, se muestra un recuadro neutro.
const EXTENSIONES = ['jpg', 'webp', 'png']

function ImagenProducto({ sku, descripcion }) {
  const [intento, setIntento] = useState(0)
  if (intento < EXTENSIONES.length) {
    return (
      <img
        className="sim-producto-img"
        src={`/productos/${sku}.${EXTENSIONES[intento]}`}
        alt={descripcion}
        loading="lazy"
        onError={() => setIntento(intento + 1)}
        style={{ objectFit: 'cover' }}
      />
    )
  }
  return (
    <svg className="sim-producto-img" viewBox="0 0 120 90" role="img" aria-label={`${descripcion} (sin imagen)`}>
      <rect width="120" height="90" fill="#eef1f6" />
      <rect x="38" y="24" width="44" height="42" rx="6" fill="#c3ccda" />
      <path d="M48 40h24M48 48h16" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export default ImagenProducto
