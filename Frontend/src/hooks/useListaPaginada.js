import { useEffect, useState } from 'react'

/**
 * Lista paginada en el servidor con busqueda: pide cada pagina al servidor (nunca trae todo), espera un momento tras escribir
 * (retardoMs) y vuelve a la pagina 1 al cambiar la busqueda. `version` fuerza una recarga (por ejemplo tras crear algo).
 *   cargar({ q, pagina, porPagina }) -> Promise<{ total, total_paginas, data }>
 */
export default function useListaPaginada(cargar, { q = '', version = 0, porPaginaInicial = 10, retardoMs = 300 } = {}) {
  const [busqueda, setBusqueda] = useState(q)
  const [pagina, setPagina] = useState(1)
  const [porPagina, setPorPagina] = useState(porPaginaInicial)
  const [estado, setEstado] = useState({ filas: [], total: 0, totalPaginas: 1, cargando: true, error: null })

  // espera a que termine de escribir
  useEffect(() => {
    const t = setTimeout(() => {
      setBusqueda(q)
      setPagina(1)
    }, q === busqueda ? 0 : retardoMs)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let vigente = true
    setEstado((e) => ({ ...e, cargando: true, error: null }))
    cargar({ q: busqueda, pagina, porPagina })
      .then((r) => {
        if (!vigente) return
        setEstado({ filas: r.data ?? [], total: r.total ?? 0, totalPaginas: r.total_paginas ?? 1, cargando: false, error: null })
      })
      .catch((err) => vigente && setEstado((e) => ({ ...e, cargando: false, error: err.message })))
    return () => {
      vigente = false
    }
  }, [cargar, busqueda, pagina, porPagina, version])

  return {
    ...estado,
    pagina,
    porPagina,
    setPagina,
    cambiarPorPagina: (n) => {
      setPorPagina(n)
      setPagina(1)
    },
  }
}
