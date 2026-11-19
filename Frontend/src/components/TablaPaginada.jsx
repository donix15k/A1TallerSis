import { useCallback, useEffect, useRef, useState } from 'react'
import Paginacion from './Paginacion.jsx'

// Tabla con scroll propio y paginacion, reutilizable en cualquier lista larga.
//   items:        todas las filas (ya filtradas); se cortan aqui por pagina.
//   children:     funcion que recibe las filas visibles y devuelve el <table> (cabecera pegada arriba).
//   sinSaltos:    celdas en una sola linea (tablas anchas); el desborde se desplaza en horizontal.
//   claveReinicio: cuando cambia (p. ej. los filtros), vuelve a la pagina 1.
// Funciona mejor dentro de una pantalla con la clase "vx-pantalla-fija" (ver vortrix.css):
// ahi la pagina no se desplaza, solo esta tabla.
function TablaPaginada({ items, children, nombre = 'registros', claveReinicio = '', porPaginaInicial = 20, opciones, sinSaltos = false }) {
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState(porPaginaInicial)
  const [modoSalto, setModoSalto] = useState(null) // null | 'abajo' | 'arriba'
  const scrollRef = useRef(null)

  // Vuelve a la pagina 1 al cambiar filtros o las filas por pagina (no al recargar tras una accion).
  useEffect(() => {
    setPagina(1)
  }, [claveReinicio, porPagina])

  const totalPaginas = Math.max(1, Math.ceil(items.length / porPagina))
  const paginaActual = Math.min(pagina, totalPaginas) // si al recargar hay menos paginas, no se queda en una vacia
  const visibles = items.slice((paginaActual - 1) * porPagina, paginaActual * porPagina)

  // Boton flotante: "ir al final" arriba del todo, "volver arriba" una vez que se desplazo.
  const actualizarSalto = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const hayScroll = el.scrollHeight - el.clientHeight > 80
    setModoSalto(!hayScroll ? null : el.scrollTop > 40 ? 'arriba' : 'abajo')
  }, [])

  useEffect(() => {
    actualizarSalto()
    window.addEventListener('resize', actualizarSalto)
    return () => window.removeEventListener('resize', actualizarSalto)
  }, [visibles.length, actualizarSalto])

  function irAPagina(n) {
    setPagina(Math.min(Math.max(1, n), totalPaginas))
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }

  function saltar() {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: modoSalto === 'abajo' ? el.scrollHeight : 0 })
  }

  return (
    <div className={`vx-tabla-tarjeta${sinSaltos ? ' vx-tabla-tarjeta--nowrap' : ''}`}>
      <div className="vx-tabla-scroll" ref={scrollRef} onScroll={actualizarSalto}>
        {children(visibles)}
      </div>

      {modoSalto && (
        <button
          type="button"
          className="vx-saltar"
          onClick={saltar}
          aria-label={modoSalto === 'abajo' ? 'Ir al final de la lista' : 'Volver al inicio de la lista'}
          title={modoSalto === 'abajo' ? 'Ir al final' : 'Volver arriba'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={modoSalto === 'abajo' ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'} />
          </svg>
        </button>
      )}

      <Paginacion
        pagina={paginaActual}
        porPagina={porPagina}
        total={items.length}
        onPagina={irAPagina}
        onPorPagina={setPorPagina}
        nombre={nombre}
        opciones={opciones}
      />
    </div>
  )
}

export default TablaPaginada
