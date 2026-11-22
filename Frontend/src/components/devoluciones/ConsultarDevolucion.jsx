import { useCallback, useEffect, useState } from 'react'
import { obtenerDevolucion } from '../../api/devoluciones.js'
import Boton from '../ui/Boton.jsx'
import Icono from '../ui/Icono.jsx'
import { Aviso, Esqueleto, Vacio } from '../ui/Aviso.jsx'
import DetalleDevolucion from './DetalleDevolucion.jsx'
import ModalReembolso from './ModalReembolso.jsx'
import ListaRecientes from './ListaRecientes.jsx'

const CLAVE_RECIENTES = 'tallersis_devoluciones_recientes'

function leerRecientes() {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE_RECIENTES)) ?? []
  } catch {
    return []
  }
}

/** Guarda una devolucion en "recientes" de esta sesion (las aprobadas aparecen aqui para reembolsarlas rapido). */
export function recordarDevolucion(d) {
  try {
    const lista = leerRecientes().filter((x) => x.codigo !== d.codigo)
    lista.unshift({ codigo: d.codigo, estado: d.estado, monto_total: d.monto_total, factura_numero: d.factura_numero })
    sessionStorage.setItem(CLAVE_RECIENTES, JSON.stringify(lista.slice(0, 8)))
  } catch {
    // sin sessionStorage la lista de recientes simplemente no persiste
  }
}

/** "4" -> "DEV-0004", "dev-12" -> "DEV-0012" */
function normalizarCodigo(valor) {
  const limpio = String(valor ?? '').trim().toUpperCase()
  const n = limpio.replace(/^DEV-?/, '')
  return /^\d{1,10}$/.test(n) ? `DEV-${n.padStart(4, '0')}` : limpio
}

/**
 * TDSI-44/51: el cajero consulta una devolucion por su codigo y, si esta APROBADA, la reembolsa.
 * Las aprobadas en esta sesion aparecen como accesos rapidos.
 *   seccionesDetalle(devolucion, recargar): secciones extra del detalle (nota de credito, Compras, Marketplace).
 */
function ConsultarDevolucion({ cajero, codigoInicial, permitirVale, seccionesDetalle, renderResultadoReembolso, versionListado = 0 }) {
  const [codigo, setCodigo] = useState(codigoInicial ?? '')
  const [devolucion, setDevolucion] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [noExiste, setNoExiste] = useState(null)
  const [reembolsando, setReembolsando] = useState(false)
  const [versionLista, setVersionLista] = useState(0) // recarga el panel lateral al consultar o reembolsar

  const consultar = useCallback(async (valor) => {
    const cod = normalizarCodigo(valor)
    if (!cod) return
    setCodigo(cod)
    setCargando(true)
    setError(null)
    setNoExiste(null)
    try {
      const r = await obtenerDevolucion(cod)
      setDevolucion(r.data)
      recordarDevolucion(r.data)
      setVersionLista((v) => v + 1)
    } catch (err) {
      setDevolucion(null)
      if (err.status === 404) setNoExiste(cod)
      else setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    if (codigoInicial) consultar(codigoInicial)
  }, [codigoInicial, consultar])

  return (
    <div className="dev-layout">
      <ListaRecientes seleccionado={devolucion?.codigo ?? normalizarCodigo(codigo)} onElegir={consultar} version={versionLista + versionListado} />
      <div>
      <div className="vxp-card">
        <h2 className="vxp-card-titulo">
          Consultar devolución
          <small>Las aprobadas se reembolsan desde aquí</small>
        </h2>
        <form
          className="vxp-buscador"
          onSubmit={(e) => {
            e.preventDefault()
            consultar(codigo)
          }}
        >
          <div className="vxp-buscador-campo">
            <Icono nombre="buscar" tam={19} />
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="Código de la devolución, ej. DEV-0004"
              aria-label="Código de la devolución"
              maxLength={15}
              autoComplete="off"
            />
          </div>
          <Boton type="submit" tam="lg" icono="buscar" cargando={cargando}>
            Consultar
          </Boton>
        </form>

      </div>

      {cargando && (
        <div className="vxp-card">
          <Esqueleto filas={5} />
        </div>
      )}
      {!cargando && error && (
        <div className="vxp-card">
          <Aviso tono="bad" titulo="No se pudo consultar">
            {error}
          </Aviso>
        </div>
      )}
      {!cargando && noExiste && (
        <div className="vxp-card">
          <Vacio icono="devolucion" titulo={`No se encontró la devolución ${noExiste}`}>
            Revise el código que le dieron al cliente.
          </Vacio>
        </div>
      )}
      {!cargando && devolucion && (
        <div style={{ marginTop: '1rem' }}>
          <DetalleDevolucion devolucion={devolucion} onReembolsar={() => setReembolsando(true)}>
            {seccionesDetalle?.(devolucion, () => consultar(devolucion.codigo))}
          </DetalleDevolucion>
        </div>
      )}

      {reembolsando && devolucion && (
        <ModalReembolso
          codigo={devolucion.codigo}
          origen={devolucion.origen}
          cajero={cajero}
          permitirVale={permitirVale}
          renderResultadoExtra={renderResultadoReembolso}
          onReembolsada={() => consultar(devolucion.codigo)}
          onCerrar={() => setReembolsando(false)}
        />
      )}
      </div>
    </div>
  )
}

export default ConsultarDevolucion
