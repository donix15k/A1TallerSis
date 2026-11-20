import { useRef, useState } from 'react'
import { buscarFacturaParaDevolucion } from '../api/devoluciones.js'
import Boton from '../components/ui/Boton.jsx'
import Icono from '../components/ui/Icono.jsx'
import { Aviso, Esqueleto, Vacio } from '../components/ui/Aviso.jsx'
import DatosFactura from '../components/devoluciones/DatosFactura.jsx'
import TablaProductosDevolucion, { claveProducto } from '../components/devoluciones/TablaProductosDevolucion.jsx'

const FORMATO_FACTURA = /^F-\d{6}$/

/** "123" -> "F-000123", "f-000123" -> "F-000123". Lo demas se deja como lo escribio (y se valida). */
export function normalizarNumeroFactura(valor) {
  const limpio = String(valor ?? '').trim().toUpperCase()
  if (/^\d{1,6}$/.test(limpio)) return `F-${limpio.padStart(6, '0')}`
  if (/^F-?\d{1,6}$/.test(limpio)) return `F-${limpio.replace(/^F-?/, '').padStart(6, '0')}`
  return limpio
}

// TDSI-8/13: pantalla "Devoluciones" del cajero. Busca la factura por su numero y muestra que se puede devolver.
function Devoluciones() {
  const [numero, setNumero] = useState('')
  const [errorFormato, setErrorFormato] = useState(null)
  const [buscando, setBuscando] = useState(false)
  const [consulta, setConsulta] = useState(null)
  const [noEncontrada, setNoEncontrada] = useState(null)
  const [errorApi, setErrorApi] = useState(null)
  const [seleccion, setSeleccion] = useState({})
  const inputRef = useRef(null)

  async function buscar(e) {
    e?.preventDefault()
    const normalizado = normalizarNumeroFactura(numero)
    if (!FORMATO_FACTURA.test(normalizado)) {
      setErrorFormato('Escriba el número con el formato F-NNNNNN (por ejemplo F-000123).')
      inputRef.current?.focus()
      return
    }
    setNumero(normalizado)
    setErrorFormato(null)
    setErrorApi(null)
    setNoEncontrada(null)
    setBuscando(true)
    try {
      const respuesta = await buscarFacturaParaDevolucion(normalizado)
      setConsulta(respuesta.data)
      setSeleccion({})
    } catch (err) {
      setConsulta(null)
      if (err.status === 404) setNoEncontrada(normalizado)
      else setErrorApi(err.message)
    } finally {
      setBuscando(false)
    }
  }

  function alternar(item) {
    const clave = claveProducto(item)
    setSeleccion((previa) => {
      const nueva = { ...previa }
      if (nueva[clave]) delete nueva[clave]
      else nueva[clave] = { cantidad: Math.min(1, item.cantidad_disponible) || item.cantidad_disponible }
      return nueva
    })
  }

  const fueraDePlazo = consulta?.bloqueo?.codigo === 'FUERA_DE_PLAZO'
  const facturaNoValida = consulta?.bloqueo?.codigo === 'FACTURA_NO_VALIDA'

  return (
    <section>
      <header className="vxp-hero">
        <div className="vxp-hero-titulo">
          <span className="vxp-hero-icono">
            <Icono nombre="devolucion" tam={24} />
          </span>
          <div>
            <h1>Devoluciones</h1>
            <p>Busque la factura del cliente para ver qué productos todavía puede devolver.</p>
          </div>
        </div>
      </header>

      <div className="vxp-card">
        <h2 className="vxp-card-titulo">
          Buscar factura
          <small>Plazo de devolución: 7 días calendario desde la compra</small>
        </h2>
        <form className="vxp-buscador" onSubmit={buscar} noValidate>
          <div className="vxp-buscador-campo">
            <Icono nombre="buscar" tam={19} />
            <input
              ref={inputRef}
              value={numero}
              onChange={(e) => {
                setNumero(e.target.value.toUpperCase())
                if (errorFormato) setErrorFormato(null)
              }}
              onBlur={() => numero && setNumero(normalizarNumeroFactura(numero))}
              placeholder="Número de factura, ej. F-000123"
              aria-label="Número de factura"
              aria-invalid={Boolean(errorFormato)}
              className={errorFormato ? 'vxp-input--error' : undefined}
              maxLength={12}
              autoComplete="off"
              autoFocus
            />
          </div>
          <Boton type="submit" tam="lg" icono="buscar" cargando={buscando}>
            Buscar
          </Boton>
        </form>
        {errorFormato && <p className="vxp-campo-error" style={{ margin: '0.5rem 0 0' }}>{errorFormato}</p>}
      </div>

      {buscando && (
        <div className="vxp-card">
          <Esqueleto filas={5} />
        </div>
      )}

      {!buscando && errorApi && (
        <div className="vxp-card">
          <Aviso tono="bad" titulo="No se pudo consultar la factura">
            {errorApi}
          </Aviso>
        </div>
      )}

      {!buscando && noEncontrada && (
        <div className="vxp-card">
          <Vacio icono="factura" titulo="No se encontró la factura">
            Revise el número <span className="vxp-codigo">{noEncontrada}</span> e intente de nuevo.
          </Vacio>
        </div>
      )}

      {!buscando && consulta && (
        <div className="vxp-escalon">
          <div className="vxp-card">
            <DatosFactura factura={consulta.factura} plazo={consulta.plazo} devolvible={consulta.devolvible} />
          </div>

          {fueraDePlazo && (
            <div className="vxp-card" style={{ marginTop: '1rem' }}>
              <Aviso tono="bad" titulo="Fuera de plazo: la compra tiene más de 7 días">
                Pasaron {consulta.plazo.dias_transcurridos} días desde la compra. No se puede elegir ningún producto.
              </Aviso>
            </div>
          )}
          {facturaNoValida && (
            <div className="vxp-card" style={{ marginTop: '1rem' }}>
              <Aviso tono="bad" titulo="Factura no válida">
                {consulta.bloqueo.mensaje}
              </Aviso>
            </div>
          )}

          <div className="vxp-card" style={{ marginTop: '1rem' }}>
            <h2 className="vxp-card-titulo">
              Productos de la factura
              <small>{consulta.items.length} {consulta.items.length === 1 ? 'producto' : 'productos'}</small>
            </h2>
            <TablaProductosDevolucion items={consulta.items} devolvible={consulta.devolvible} seleccion={seleccion} onAlternar={alternar} />
          </div>
        </div>
      )}
    </section>
  )
}

export default Devoluciones
