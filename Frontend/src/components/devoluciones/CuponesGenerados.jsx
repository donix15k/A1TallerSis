import { useState } from 'react'
import useListaPaginada from '../../hooks/useListaPaginada.js'
import { listarCupones } from '../../api/devoluciones.js'
import Paginacion from '../Paginacion.jsx'
import Boton from '../ui/Boton.jsx'
import Icono from '../ui/Icono.jsx'
import { Aviso, Esqueleto, Vacio } from '../ui/Aviso.jsx'
import ImpresoraCupon from './ImpresoraCupon.jsx'
import { bs, fecha, fechaHora } from '../../utils/formato.js'

const BADGE = { ACTIVO: 'ok', USADO: 'neutro', EXPIRADO: 'bad' }

/** "Cupones": todos los vales emitidos (el mas reciente primero) con el cliente, fecha y hora, monto y estado; cada uno se puede ver e imprimir. */
function CuponesGenerados() {
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState(null)
  const lista = useListaPaginada(listarCupones, { q })

  return (
    <div className="vxp-card">
      <h2 className="vxp-card-titulo">
        Cupones generados
        <small>Los vales de consumo que se entregaron en lugar de dinero</small>
      </h2>

      <div className="vxp-buscador" style={{ marginBottom: '1rem' }}>
        <div className="vxp-buscador-campo">
          <Icono nombre="buscar" tam={19} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por cupón, devolución, factura o NIT/CI" aria-label="Buscar cupones" autoComplete="off" />
        </div>
      </div>

      {lista.error && (
        <Aviso tono="bad" titulo="No se pudieron cargar los cupones">
          {lista.error}
        </Aviso>
      )}
      {lista.cargando && lista.filas.length === 0 && <Esqueleto filas={5} />}
      {!lista.cargando && !lista.error && lista.filas.length === 0 && (
        <Vacio icono="dinero" titulo={q ? 'No hay cupones que coincidan' : 'Todavía no se generó ningún cupón'}>
          {q ? 'Pruebe con otro código, factura o NIT/CI.' : 'Los cupones aparecen aquí cuando una devolución se reembolsa con vale.'}
        </Vacio>
      )}

      {lista.filas.length > 0 && (
        <div className={`dev-tabla${lista.cargando ? ' dev-tabla--cargando' : ''}`}>
          <table className="vxp-tabla">
            <thead>
              <tr>
                <th>Cupón</th>
                <th>Fecha y hora</th>
                <th>Cliente</th>
                <th>NIT / CI</th>
                <th>Devolución</th>
                <th className="num">Monto</th>
                <th>Vence</th>
                <th>Estado</th>
                <th aria-label="Acción" />
              </tr>
            </thead>
            <tbody>
              {lista.filas.map((c) => (
                <tr key={c.codigo}>
                  <td>
                    <span className="vxp-codigo">{c.codigo}</span>
                  </td>
                  <td>{fechaHora(c.emitido_en)}</td>
                  <td>{c.cliente_nombre || '—'}</td>
                  <td>{c.cliente_nit || '—'}</td>
                  <td>
                    <span className="vxp-codigo">{c.devolucion_codigo}</span>
                  </td>
                  <td className="num">{bs(c.monto)}</td>
                  <td>{fecha(c.vence_en)}</td>
                  <td>
                    <span className={`vxp-badge vxp-badge--${BADGE[c.estado] ?? 'neutro'}`}>{c.estado}</span>
                  </td>
                  <td className="dev-accion">
                    <Boton tam="sm" icono="imprimir" onClick={() => setAbierto(c)}>
                      Ver e imprimir
                    </Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lista.total > 0 && (
        <Paginacion pagina={lista.pagina} porPagina={lista.porPagina} total={lista.total} onPagina={lista.setPagina} onPorPagina={lista.cambiarPorPagina} opciones={[10, 20, 50]} nombre="cupones" />
      )}

      {abierto && <ImpresoraCupon cupon={abierto} onCerrar={() => setAbierto(null)} />}
    </div>
  )
}

export default CuponesGenerados
