import { useMemo, useState } from 'react'
import { CATALOGO_PRODUCTOS, MAX_UNIDADES, totalCarrito } from '../../utils/catalogoProductos.js'
import { bs } from '../../utils/formato.js'
import './TiendaCajero.css'

const EXTENSIONES = ['jpg', 'webp', 'png']

function Foto({ sku, descripcion }) {
  const [intento, setIntento] = useState(0)
  if (intento >= EXTENSIONES.length) return <div className="tc-foto tc-foto--vacia" role="img" aria-label={`${descripcion} (sin imagen)`} />
  return <img className="tc-foto" src={`/productos/${sku}.${EXTENSIONES[intento]}`} alt={descripcion} loading="lazy" onError={() => setIntento(intento + 1)} />
}

/**
 * La tiendita del cajero: el mismo catalogo que el Marketplace. Al agregar productos el total se calcula solo y pasa al campo "Monto" del cobro.
 * El carrito ({ sku: unidades }) vive en la pantalla de Pagos para que se limpie al terminar o cancelar la venta.
 */
export default function TiendaCajero({ carrito, onCambiar }) {
  const [categoria, setCategoria] = useState('Todos')
  const categorias = useMemo(() => ['Todos', ...new Set(CATALOGO_PRODUCTOS.map((p) => p.categoria))], [])
  const visibles = CATALOGO_PRODUCTOS.filter((p) => categoria === 'Todos' || p.categoria === categoria)
  const lineas = CATALOGO_PRODUCTOS.filter((p) => carrito[p.sku] > 0).map((p) => ({ ...p, cantidad: carrito[p.sku] }))
  const unidades = lineas.reduce((a, l) => a + l.cantidad, 0)
  const total = totalCarrito(carrito)

  const cambiar = (sku, delta) => {
    const n = Math.max(0, Math.min(MAX_UNIDADES, (carrito[sku] ?? 0) + delta))
    const siguiente = { ...carrito, [sku]: n }
    if (n === 0) delete siguiente[sku]
    onCambiar(siguiente)
  }

  return (
    <aside className="tc" aria-label="Productos de la tienda">
      <header className="tc-cab">
        <div>
          <h2>Productos</h2>
          <small>Elige lo que lleva el cliente: el total pasa solo al cobro.</small>
        </div>
        <div className="tc-total">
          <span>{unidades} {unidades === 1 ? 'producto' : 'productos'}</span>
          <b>{bs(total)}</b>
        </div>
      </header>

      <div className="tc-filtros" role="group" aria-label="Categoría">
        {categorias.map((c) => (
          <button key={c} type="button" className="tc-filtro" aria-pressed={categoria === c} onClick={() => setCategoria(c)}>{c}</button>
        ))}
      </div>

      <div className="tc-grilla">
        {visibles.map((p) => {
          const n = carrito[p.sku] ?? 0
          return (
            <article key={p.sku} className={`tc-producto${n > 0 ? ' tc-producto--elegido' : ''}`}>
              <Foto sku={p.sku} descripcion={p.descripcion} />
              <div className="tc-datos">
                <h3>{p.descripcion}</h3>
                <small>{p.sku} · {p.categoria}</small>
              </div>
              <div className="tc-precio">{bs(p.precio)}</div>
              <div className="tc-paso" role="group" aria-label={`Unidades de ${p.descripcion}`}>
                <button type="button" onClick={() => cambiar(p.sku, -1)} disabled={n === 0} aria-label="Quitar una unidad">−</button>
                <output>{n}</output>
                <button type="button" onClick={() => cambiar(p.sku, 1)} disabled={n >= MAX_UNIDADES} aria-label="Agregar una unidad">+</button>
              </div>
            </article>
          )
        })}
      </div>

      {lineas.length > 0 && (
        <footer className="tc-pie">
          <ul>
            {lineas.map((l) => (
              <li key={l.sku}><span>{l.cantidad} × {l.descripcion}</span><b>{bs(l.cantidad * l.precio)}</b></li>
            ))}
          </ul>
          <button type="button" className="tc-vaciar" onClick={() => onCambiar({})}>Vaciar productos</button>
        </footer>
      )}
    </aside>
  )
}
