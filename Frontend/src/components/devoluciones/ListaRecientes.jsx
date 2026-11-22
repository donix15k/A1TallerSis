import { useCallback } from 'react'
import useListaPaginada from '../../hooks/useListaPaginada.js'
import { listarDevolucionesRecientes } from '../../api/devoluciones.js'
import { ESTADO_BADGE } from './DetalleDevolucion.jsx'
import { Esqueleto } from '../ui/Aviso.jsx'
import { bs, fechaHora } from '../../utils/formato.js'

/**
 * Panel lateral "Recientes": los codigos de devolucion, el mas reciente arriba y el mas antiguo abajo, 10 por pagina.
 * Angosto a proposito: el detalle de la devolucion ocupa el resto de la pantalla.
 */
function ListaRecientes({ seleccionado, onElegir, version }) {
  const cargar = useCallback(({ pagina, porPagina }) => listarDevolucionesRecientes({ pagina, porPagina }), [])
  const lista = useListaPaginada(cargar, { version, porPaginaInicial: 10, retardoMs: 0 })

  return (
    <aside className="dev-recientes" aria-label="Devoluciones recientes">
      <h2 className="dev-recientes-titulo">
        Recientes
        {lista.total > 0 && <small>{lista.total}</small>}
      </h2>

      {lista.cargando && lista.filas.length === 0 && <Esqueleto filas={5} />}
      {lista.error && <p className="vxp-campo-error">{lista.error}</p>}
      {!lista.cargando && !lista.error && lista.filas.length === 0 && <p className="vxp-texto-suave dev-recientes-vacio">Aún no hay devoluciones.</p>}

      <ul className="dev-recientes-lista">
        {lista.filas.map((d) => (
          <li key={d.codigo}>
            <button
              type="button"
              className={`dev-reciente${seleccionado === d.codigo ? ' dev-reciente--activa' : ''}`}
              onClick={() => onElegir(d.codigo)}
              title={`${d.factura_numero} · ${bs(d.monto_total)} · ${fechaHora(d.fecha_solicitud)}`}
            >
              <span className="dev-reciente-fila">
                <span className="vxp-codigo">{d.codigo}</span>
                <span className={`vxp-badge vxp-badge--${ESTADO_BADGE[d.estado] ?? 'neutro'}`} style={{ fontSize: '0.6rem', padding: '0.08rem 0.4rem' }}>
                  {d.estado}
                </span>
              </span>
              <span className="dev-reciente-sub">
                {d.factura_numero} · {bs(d.monto_total)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {lista.totalPaginas > 1 && (
        <nav className="dev-recientes-pag" aria-label="Paginación de recientes">
          <button type="button" onClick={() => lista.setPagina(lista.pagina - 1)} disabled={lista.pagina <= 1} aria-label="Página anterior">
            ‹
          </button>
          <span>
            {lista.pagina} / {lista.totalPaginas}
          </span>
          <button type="button" onClick={() => lista.setPagina(lista.pagina + 1)} disabled={lista.pagina >= lista.totalPaginas} aria-label="Página siguiente">
            ›
          </button>
        </nav>
      )}
    </aside>
  )
}

export default ListaRecientes
