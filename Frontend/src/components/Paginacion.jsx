import './Paginacion.css'

// Numeros de pagina a mostrar: siempre la primera y la ultima, la actual con sus vecinas
// y "…" donde se salta (p. ej. 1 … 6 7 [8] 9 10 … 62).
function numerosVisibles(pagina, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const numeros = new Set([1, total, pagina - 1, pagina, pagina + 1])
  if (pagina <= 3) [2, 3, 4].forEach((n) => numeros.add(n))
  if (pagina >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => numeros.add(n))
  const ordenados = [...numeros].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const resultado = []
  ordenados.forEach((n, i) => {
    if (i > 0 && n - ordenados[i - 1] > 1) resultado.push(`…${n}`)
    resultado.push(n)
  })
  return resultado
}

const formato = new Intl.NumberFormat('es-BO')

function Flecha({ direccion, doble = false }) {
  const trazos = {
    izquierda: doble ? 'M11 17l-5-5 5-5M18 17l-5-5 5-5' : 'M15 18l-6-6 6-6',
    derecha: doble ? 'M13 17l5-5-5-5M6 17l5-5-5-5' : 'M9 18l6-6-6-6',
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={trazos[direccion]} />
    </svg>
  )
}

// Barra de paginacion reutilizable: "Mostrando X–Y de N", filas por pagina y navegacion.
function Paginacion({ pagina, porPagina, total, onPagina, onPorPagina, opciones = [10, 20, 50, 100], nombre = 'registros' }) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina))
  const desde = total === 0 ? 0 : (pagina - 1) * porPagina + 1
  const hasta = Math.min(total, pagina * porPagina)

  return (
    <nav className="vx-pag" aria-label={`Paginación de ${nombre}`}>
      <p className="vx-pag-resumen">
        Mostrando <strong>{formato.format(desde)}–{formato.format(hasta)}</strong> de <strong>{formato.format(total)}</strong> {nombre}
      </p>

      <div className="vx-pag-botones">
        <button type="button" className="vx-pag-boton vx-pag-boton--icono" onClick={() => onPagina(1)} disabled={pagina === 1} aria-label="Primera página">
          <Flecha direccion="izquierda" doble />
        </button>
        <button type="button" className="vx-pag-boton vx-pag-boton--icono" onClick={() => onPagina(pagina - 1)} disabled={pagina === 1} aria-label="Página anterior">
          <Flecha direccion="izquierda" />
        </button>

        {numerosVisibles(pagina, totalPaginas).map((n) =>
          typeof n === 'string' ? (
            <span className="vx-pag-puntos" key={n} aria-hidden="true">…</span>
          ) : (
            <button
              type="button"
              key={n}
              className={`vx-pag-boton${n === pagina ? ' vx-pag-boton--activa' : ''}`}
              onClick={() => onPagina(n)}
              aria-label={`Página ${n}`}
              aria-current={n === pagina ? 'page' : undefined}
            >
              {n}
            </button>
          ),
        )}

        <button type="button" className="vx-pag-boton vx-pag-boton--icono" onClick={() => onPagina(pagina + 1)} disabled={pagina === totalPaginas} aria-label="Página siguiente">
          <Flecha direccion="derecha" />
        </button>
        <button type="button" className="vx-pag-boton vx-pag-boton--icono" onClick={() => onPagina(totalPaginas)} disabled={pagina === totalPaginas} aria-label="Última página">
          <Flecha direccion="derecha" doble />
        </button>
      </div>

      <label className="vx-pag-filas">
        Filas por página
        <select value={porPagina} onChange={(e) => onPorPagina(Number(e.target.value))}>
          {opciones.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </nav>
  )
}

export default Paginacion
