import useListaPaginada from '../../hooks/useListaPaginada.js'
import { listarFacturasParaDevolucion } from '../../api/devoluciones.js'
import Paginacion from '../Paginacion.jsx'
import Boton from '../ui/Boton.jsx'
import { Aviso, Esqueleto, Vacio } from '../ui/Aviso.jsx'
import { bs, fechaHora } from '../../utils/formato.js'

function EtiquetaPlazo({ f }) {
  if (f.estado === 'Anulada') return <span className="vxp-badge vxp-badge--bad">Anulada</span>
  if (!f.dentro_de_plazo) return <span className="vxp-badge vxp-badge--bad">Vencida · hace {f.dias_transcurridos - 7} {f.dias_transcurridos - 7 === 1 ? 'día' : 'días'}</span>
  return (
    <span className="vxp-badge vxp-badge--ok">
      Vigente · {f.dias_restantes === 0 ? 'último día' : `quedan ${f.dias_restantes} ${f.dias_restantes === 1 ? 'día' : 'días'}`}
    </span>
  )
}

/**
 * "Nueva devolucion": todas las facturas con su codigo y si siguen vigentes (7 dias), cada una con su boton para hacer la devolucion.
 * La busqueda (numero, cliente o NIT/CI) se hace en el servidor, asi sirve aunque haya miles de facturas; la tabla esta paginada.
 */
function ListadoFacturas({ q, onElegir, version }) {
  const lista = useListaPaginada(listarFacturasParaDevolucion, { q, version })

  return (
    <div className="vxp-card">
      <h2 className="vxp-card-titulo">
        Facturas
        <small>{q ? 'Resultados de la búsqueda' : 'Las más recientes primero'} · plazo de devolución: 7 días</small>
      </h2>

      {lista.error && (
        <Aviso tono="bad" titulo="No se pudo cargar el listado">
          {lista.error}
        </Aviso>
      )}
      {lista.cargando && lista.filas.length === 0 && <Esqueleto filas={6} />}
      {!lista.cargando && !lista.error && lista.filas.length === 0 && (
        <Vacio icono="factura" titulo={q ? 'No hay facturas que coincidan' : 'Todavía no hay facturas'}>
          {q ? 'Pruebe con otro número, nombre o NIT/CI.' : 'Cuando se emitan facturas aparecerán aquí.'}
        </Vacio>
      )}

      {lista.filas.length > 0 && (
        <div className={`dev-tabla${lista.cargando ? ' dev-tabla--cargando' : ''}`}>
          <table className="vxp-tabla dev-tabla-facturas">
            <thead>
              <tr>
                <th>Factura</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>NIT / CI</th>
                <th className="num">Total</th>
                <th>Plazo</th>
                <th aria-label="Acción" />
              </tr>
            </thead>
            <tbody>
              {lista.filas.map((f) => (
                <tr key={f.numero} className={f.devolvible ? undefined : 'vxp-fila--deshabilitada'}>
                  <td>
                    <span className="vxp-codigo">{f.numero}</span>
                  </td>
                  <td>{fechaHora(f.fecha)}</td>
                  <td>{f.cliente_nombre || '—'}</td>
                  <td>{f.cliente_nit || '—'}</td>
                  <td className="num">{bs(f.total)}</td>
                  <td>
                    <EtiquetaPlazo f={f} />
                  </td>
                  <td className="dev-accion">
                    <Boton tam="sm" variante={f.devolvible ? 'primario' : 'claro'} icono="devolucion" onClick={() => onElegir(f.numero)}>
                      {f.devolvible ? 'Hacer devolución' : 'Ver'}
                    </Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lista.total > 0 && (
        <Paginacion
          pagina={lista.pagina}
          porPagina={lista.porPagina}
          total={lista.total}
          onPagina={lista.setPagina}
          onPorPagina={lista.cambiarPorPagina}
          opciones={[10, 20, 50]}
          nombre="facturas"
        />
      )}
    </div>
  )
}

export default ListadoFacturas
