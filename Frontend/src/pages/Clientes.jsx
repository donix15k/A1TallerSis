import { useEffect, useMemo, useState } from 'react'
import { historialCliente, listarClientes } from '../api/pagos.js'
import BotonVerFactura from '../components/BotonVerFactura.jsx'
import Cargando from '../components/Cargando.jsx'
import TablaPaginada from '../components/TablaPaginada.jsx'

const TIPOS_DOCUMENTO = [
  { id: '', etiqueta: 'Todos' },
  { id: 'NIT', etiqueta: 'NIT' },
  { id: 'CI', etiqueta: 'CI' },
]

// TDSI-327: el administrador ve todos los clientes (el último atendido primero), filtra por
// NIT/CI, nombre o número, y al elegir uno ve cuántas veces vino y qué ha facturado cada vez.
function Clientes() {
  const [clientes, setClientes] = useState([])
  const [cargandoLista, setCargandoLista] = useState(true)
  const [errorLista, setErrorLista] = useState(null)
  const [tipoDocumento, setTipoDocumento] = useState('')
  const [texto, setTexto] = useState('')

  const [cliente, setCliente] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [buscado, setBuscado] = useState(false)

  useEffect(() => {
    listarClientes()
      .then((r) => setClientes(r.data))
      .catch((err) => setErrorLista(err.message))
      .finally(() => setCargandoLista(false))
  }, [])

  const visibles = useMemo(() => {
    const q = texto.trim().toLowerCase()
    return clientes.filter(
      (c) =>
        (!tipoDocumento || c.tipo_documento === tipoDocumento) &&
        (!q || `${c.razon_social || ''} ${c.numero}`.toLowerCase().includes(q))
    )
  }, [clientes, tipoDocumento, texto])

  async function verHistorial(c) {
    setCargando(true)
    setError(null)
    setBuscado(true)
    try {
      const respuesta = await historialCliente(c.tipo_documento, c.numero)
      setCliente(respuesta.data)
    } catch (err) {
      setCliente(null)
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }

  return (
    <section>
      <h1>Clientes</h1>
      <p>Todos los clientes, del último atendido al más antiguo. Use el filtro para encontrar uno por nombre, NIT o CI.</p>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <div className="tipo-venta-opciones">
          {TIPOS_DOCUMENTO.map((tipo) => (
            <button
              key={tipo.id}
              type="button"
              className={`tipo-venta-opcion${tipoDocumento === tipo.id ? ' activa' : ''}`}
              onClick={() => setTipoDocumento(tipo.id)}
            >
              {tipo.etiqueta}
            </button>
          ))}
        </div>

        <label className="campo" style={{ marginBottom: 0 }}>
          Filtrar
          <input
            type="search"
            placeholder="Nombre o número de documento"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </label>
      </div>

      {cargandoLista && <Cargando />}
      {errorLista && <p className="error">{errorLista}</p>}
      {error && <p className="error">{error}</p>}
      {cargando && <Cargando />}

      {buscado && !cargando && !error && cliente && (
        <div className="cliente-resumen">
          <h2>{cliente.razon_social || 'Cliente'}</h2>
          <p style={{ color: '#616e7c', marginTop: '-0.5rem' }}>
            {cliente.tipo_documento}: {cliente.numero}
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', margin: '1rem 0' }}>
            <div style={{ padding: '1rem', backgroundColor: '#ecfdf5', borderRadius: '8px', border: '1px solid #a7f3d0' }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#065f46' }}>Veces que vino</p>
              <p style={{ margin: 0, fontSize: '1.3rem', fontWeight: 'bold', color: '#065f46' }}>{cliente.cantidadCompras}</p>
            </div>
            <div style={{ padding: '1rem', backgroundColor: '#eef2ff', borderRadius: '8px', border: '1px solid #c7d2fe' }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#3730a3' }}>Total gastado</p>
              <p style={{ margin: 0, fontSize: '1.3rem', fontWeight: 'bold', color: '#3730a3' }}>Bs. {cliente.totalGastado.toFixed(2)}</p>
            </div>
            {cliente.cantidadAnuladas > 0 && (
              <div style={{ padding: '1rem', backgroundColor: '#fef2f2', borderRadius: '8px', border: '1px solid #fecdd3' }}>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#b91c1c' }}>Facturas anuladas</p>
                <p style={{ margin: 0, fontSize: '1.3rem', fontWeight: 'bold', color: '#b91c1c' }}>{cliente.cantidadAnuladas}</p>
              </div>
            )}
          </div>

          <table className="tabla-facturas">
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Método(s)</th>
                <th>Total (Bs.)</th>
                <th>Cajero</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cliente.facturas.map((f) => (
                <tr key={f.id_transaccion}>
                  <td>{f.id_transaccion}</td>
                  <td>{new Date(f.fecha).toLocaleString()}</td>
                  <td>{f.metodos.join(' + ')}</td>
                  <td>{f.total.toFixed(2)}</td>
                  <td>{f.cajero || '-'}</td>
                  <td>
                    <span className={`badge-estado ${f.estado === 'Registrado' ? 'badge-estado--emitida' : ''}`}>
                      {f.estado === 'Registrado' ? 'Emitida' : 'Anulada'}
                    </span>
                  </td>
                  <td>
                    <BotonVerFactura idTransaccion={f.id_transaccion}>Ver</BotonVerFactura>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!cargandoLista && !errorLista && (
        <div className="cliente-resumen" style={{ marginTop: '1.5rem' }}>
          <h2>Todos los clientes ({visibles.length})</h2>
          {visibles.length === 0 ? (
            <p className="orden-mensaje orden-mensaje-pendiente cajas-mensaje">No hay clientes que coincidan con el filtro.</p>
          ) : (
            <TablaPaginada items={visibles} nombre="clientes">
              {(filas) => (
                <table className="tabla-facturas">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Documento</th>
                      <th>Veces que vino</th>
                      <th>Total gastado (Bs.)</th>
                      <th>Última visita</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((c) => (
                      <tr key={`${c.tipo_documento}-${c.numero}`}>
                        <td>{c.razon_social || '-'}</td>
                        <td>{c.tipo_documento}: {c.numero}</td>
                        <td>{c.cantidadCompras}</td>
                        <td>{c.totalGastado.toFixed(2)}</td>
                        <td>{new Date(c.ultimaVisita).toLocaleString()}</td>
                        <td>
                          <button type="button" className="btn btn-secundario" onClick={() => verHistorial(c)}>
                            Ver historial
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TablaPaginada>
          )}
        </div>
      )}
    </section>
  )
}

export default Clientes
