import { useEffect, useMemo, useRef, useState } from 'react'
import { buscarFacturaParaDevolucion, listarMotivos, registrarDevolucion } from '../api/devoluciones.js'
import { useAuth } from '../context/AuthContext.jsx'
import Boton from '../components/ui/Boton.jsx'
import Icono from '../components/ui/Icono.jsx'
import { Aviso, Esqueleto, Vacio } from '../components/ui/Aviso.jsx'
import { useToast } from '../components/ui/Toasts.jsx'
import DatosFactura from '../components/devoluciones/DatosFactura.jsx'
import TablaProductosDevolucion, { claveProducto } from '../components/devoluciones/TablaProductosDevolucion.jsx'
import FormularioRegistroDevolucion from '../components/devoluciones/FormularioRegistroDevolucion.jsx'
import ModalDevolucionRegistrada from '../components/devoluciones/ModalDevolucionRegistrada.jsx'
import BandejaPendientes from '../components/devoluciones/BandejaPendientes.jsx'
import ConsultarDevolucion, { recordarDevolucion } from '../components/devoluciones/ConsultarDevolucion.jsx'
import SeccionNotaCredito from '../components/devoluciones/SeccionNotaCredito.jsx'
import SeccionAvisos from '../components/devoluciones/SeccionAvisos.jsx'
import { EtiquetaMarketplace, FiltroOrigen } from '../components/devoluciones/Origen.jsx'
import ListadoFacturas from '../components/devoluciones/ListadoFacturas.jsx'
import CuponesGenerados from '../components/devoluciones/CuponesGenerados.jsx'

// Secciones extra del detalle de una devolucion, segun su estado.
function seccionesDetalle(devolucion) {
  // TDSI-121: una del Marketplace rechazada tambien muestra el aviso que se le mando al Marketplace.
  if (devolucion.estado === 'RECHAZADA' && devolucion.origen === 'MARKETPLACE') {
    return <SeccionAvisos key={`av-${devolucion.codigo}`} devolucion={devolucion} mostrarMarketplace ocultarCompras />
  }
  if (devolucion.estado !== 'PROCESADA') return null
  return (
    <>
      <SeccionNotaCredito key={`nc-${devolucion.codigo}`} devolucion={devolucion} /> {/* TDSI-61/62/63 */}
      <SeccionAvisos key={`av-${devolucion.codigo}`} devolucion={devolucion} mostrarMarketplace /> {/* TDSI-108/121 */}
    </>
  )
}

const ESTADOS_PRODUCTO = [
  { id: 'BUEN_ESTADO', etiqueta: 'En buen estado', icono: 'checkCirculo' },
  { id: 'DEFECTUOSO', etiqueta: 'Defectuoso', icono: 'alerta' },
]

const redondear = (n) => Math.round(n * 100) / 100

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
  const { cajero } = useAuth()
  const toast = useToast()

  // TDSI-19: registro de la devolucion
  const [motivos, setMotivos] = useState([])
  const [motivoId, setMotivoId] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [errorMotivo, setErrorMotivo] = useState(null)
  const [registrando, setRegistrando] = useState(false)
  const [registrada, setRegistrada] = useState(null)
  const [errorEstados, setErrorEstados] = useState(false) // TDSI-107: falta elegir el estado de algun producto

  // TDSI-32/38: pestañas de la pantalla (nueva devolucion y bandeja del supervisor)
  const [pestana, setPestana] = useState('nueva')
  const [pendientes, setPendientes] = useState(0)
  const [origenBandeja, setOrigenBandeja] = useState('') // TDSI-120
  const [versionBandeja, setVersionBandeja] = useState(0) // al registrar una devolucion la bandeja se recarga
  const [codigoConsulta, setCodigoConsulta] = useState(null) // TDSI-44: abre "Consultar" con una devolucion

  function abrirEnConsulta(codigo) {
    setCodigoConsulta(codigo)
    setPestana('consultar')
  }

  useEffect(() => {
    listarMotivos()
      .then((r) => setMotivos(r.data ?? []))
      .catch(() => setMotivos([]))
  }, [])

  async function buscar(e, numeroForzado) {
    e?.preventDefault()
    const normalizado = normalizarNumeroFactura(numeroForzado ?? numero)
    // Si no es un numero de factura completo, lo escrito solo filtra el listado de facturas (no es un error).
    if (!FORMATO_FACTURA.test(normalizado)) return
    setNumero(normalizado)
    setErrorFormato(null)
    setErrorApi(null)
    setNoEncontrada(null)
    setBuscando(true)
    try {
      const respuesta = await buscarFacturaParaDevolucion(normalizado)
      setConsulta(respuesta.data)
      setSeleccion({})
      setMotivoId('')
      setObservaciones('')
      setErrorMotivo(null)
    } catch (err) {
      setConsulta(null)
      if (err.status === 404) setNoEncontrada(normalizado)
      else setErrorApi(err.message)
    } finally {
      setBuscando(false)
    }
  }

  /** Vuelve al listado de facturas (cierra la factura que se estaba trabajando). */
  function volverAlListado() {
    setConsulta(null)
    setNoEncontrada(null)
    setErrorApi(null)
    setSeleccion({})
    setNumero('')
  }

  function alternar(item) {
    const clave = claveProducto(item)
    setSeleccion((previa) => {
      const nueva = { ...previa }
      if (nueva[clave]) delete nueva[clave]
      // TDSI-107: el estado del producto lo elige el cajero (obligatorio): no se asume ninguno.
      else nueva[clave] = { cantidad: item.cantidad_disponible >= 1 ? 1 : item.cantidad_disponible, estado_producto: '' }
      return nueva
    })
  }

  function cambiarCantidad(item, cantidad) {
    const clave = claveProducto(item)
    setSeleccion((previa) => (previa[clave] ? { ...previa, [clave]: { ...previa[clave], cantidad } } : previa))
  }

  function cambiarEstadoProducto(item, estado_producto) {
    const clave = claveProducto(item)
    setSeleccion((previa) => (previa[clave] ? { ...previa, [clave]: { ...previa[clave], estado_producto } } : previa))
  }

  // TDSI-107: "Estado del producto: En buen estado / Defectuoso" para cada producto elegido.
  const columnaEstadoProducto = {
    titulo: 'Estado del producto',
    render: (item, elegida) => (
      <div className="vxp-segmentos" role="radiogroup" aria-label={`Estado de ${item.descripcion}`} style={{ padding: 3, flexWrap: 'nowrap' }}>
        {ESTADOS_PRODUCTO.map((e) => {
          const activo = elegida.estado_producto === e.id
          return (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={activo}
              className={`vxp-segmento${activo ? ' vxp-segmento--activo' : ''}`}
              style={{
                padding: '0.35rem 0.6rem',
                fontSize: '0.78rem',
                ...(activo && { color: e.id === 'DEFECTUOSO' ? 'var(--vxp-bad)' : 'var(--vxp-ok)' }),
                ...(!elegida.estado_producto && errorEstados && { color: 'var(--vxp-bad)' }),
              }}
              onClick={() => {
                cambiarEstadoProducto(item, e.id)
                setErrorEstados(false)
              }}
            >
              <Icono nombre={e.icono} tam={14} />
              {e.etiqueta}
            </button>
          )
        })}
      </div>
    ),
  }

  // Lo elegido con su precio de la factura, para el resumen y para enviar.
  const elegidos = useMemo(() => {
    if (!consulta) return []
    return consulta.items
      .filter((it) => seleccion[claveProducto(it)])
      .map((it) => ({ ...it, ...seleccion[claveProducto(it)] }))
  }, [consulta, seleccion])

  const monto = redondear(elegidos.reduce((acc, it) => acc + redondear(it.cantidad * it.precio_unitario), 0))
  // TOTAL solo si se devuelve TODO lo comprado de cada producto de la factura (mismo criterio que el servidor).
  const tipo =
    consulta && elegidos.length > 0 && consulta.items.every((it) => seleccion[claveProducto(it)]?.cantidad === it.cantidad_comprada) ? 'TOTAL' : 'PARCIAL'

  async function registrar() {
    if (!motivoId) {
      setErrorMotivo('Seleccione el motivo de la devolución')
      return
    }
    const sinEstado = elegidos.find((it) => !it.estado_producto)
    if (sinEstado) {
      setErrorEstados(true)
      toast.aviso('Indique el estado del producto', `Elija "En buen estado" o "Defectuoso" para "${sinEstado.descripcion}".`)
      return
    }
    const sinCantidad = elegidos.find((it) => !(it.cantidad > 0))
    if (sinCantidad) {
      toast.aviso('Revise las cantidades', `La cantidad de "${sinCantidad.descripcion}" debe ser mayor a 0.`)
      return
    }
    setRegistrando(true)
    try {
      const respuesta = await registrarDevolucion({
        factura_numero: consulta.factura.numero,
        items: elegidos.map((it) => ({
          descripcion: it.descripcion,
          precio_unitario: it.precio_unitario,
          cantidad: it.cantidad,
          estado_producto: it.estado_producto,
        })),
        motivo_id: Number(motivoId),
        observaciones: observaciones.trim() || undefined,
        cajero: cajero?.nombre,
      })
      setRegistrada(respuesta.data)
      setVersionBandeja((v) => v + 1)
      // la tabla se refresca para que la cantidad disponible ya descuente lo registrado
      buscar(null, consulta.factura.numero)
    } catch (err) {
      toast.error('No se registró la devolución', err.message)
    } finally {
      setRegistrando(false)
    }
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
            <p>Registre devoluciones, autorícelas con un supervisor y entregue el reembolso al cliente.</p>
          </div>
        </div>
        <div className="vxp-segmentos" role="tablist" aria-label="Secciones de devoluciones" style={{ background: 'rgba(255,255,255,.12)', borderColor: 'rgba(255,255,255,.2)' }}>
          {[
            { id: 'nueva', etiqueta: 'Nueva devolución', icono: 'mas' },
            { id: 'pendientes', etiqueta: 'Pendientes', icono: 'bandeja', cuenta: pendientes },
            { id: 'consultar', etiqueta: 'Consultar y reembolsar', icono: 'dinero' },
            { id: 'cupones', etiqueta: 'Cupones', icono: 'factura' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={pestana === p.id}
              className={`vxp-segmento${pestana === p.id ? ' vxp-segmento--activo' : ''}`}
              style={pestana === p.id ? undefined : { color: 'rgba(255,255,255,.85)' }}
              onClick={() => setPestana(p.id)}
            >
              <Icono nombre={p.icono} tam={15} />
              {p.etiqueta}
              {p.cuenta > 0 && <span className="vxp-segmento-cuenta">{p.cuenta}</span>}
            </button>
          ))}
        </div>
      </header>

      <div hidden={pestana !== 'pendientes'}>
        <BandejaPendientes
          key={versionBandeja}
          onContador={setPendientes}
          renderEtiqueta={(d) => <EtiquetaMarketplace devolucion={d} />}
          filtrarFila={origenBandeja ? (d) => (d.origen ?? 'TIENDA') === origenBandeja : undefined}
          filtros={<FiltroOrigen valor={origenBandeja} onCambiar={setOrigenBandeja} compacto />}
          onAprobada={(d) => {
            // queda lista en "Consultar y reembolsar" sin sacar al supervisor de la bandeja
            recordarDevolucion(d)
            setCodigoConsulta(d.codigo)
          }}
        />
      </div>

      {pestana === 'consultar' && <ConsultarDevolucion cajero={cajero} codigoInicial={codigoConsulta} seccionesDetalle={seccionesDetalle} permitirVale versionListado={versionBandeja} />}

      {pestana === 'cupones' && <CuponesGenerados />}

      <div hidden={pestana !== 'nueva'}>
      <div className="vxp-card">
        <h2 className="vxp-card-titulo">
          Buscar factura
          <small>Plazo de devolución: 7 días calendario desde la compra</small>
        </h2>
        {(consulta || buscando || noEncontrada || errorApi) && (
          <p style={{ margin: '0 0 0.75rem' }}>
            <Boton variante="claro" tam="sm" icono="devolucion" onClick={volverAlListado}>
              Volver al listado de facturas
            </Boton>
          </p>
        )}
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
              placeholder="Buscar por número de factura, cliente o NIT/CI"
              aria-label="Buscar factura"
              aria-invalid={Boolean(errorFormato)}
              className={errorFormato ? 'vxp-input--error' : undefined}
              maxLength={60}
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

      {!consulta && !buscando && !noEncontrada && !errorApi && (
        <ListadoFacturas q={numero.trim()} version={versionBandeja} onElegir={(n) => buscar(null, n)} />
      )}

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
            <TablaProductosDevolucion
              items={consulta.items}
              devolvible={consulta.devolvible}
              seleccion={seleccion}
              onAlternar={alternar}
              onCantidad={cambiarCantidad}
              columnaExtra={columnaEstadoProducto}
            />
          </div>

          {consulta.devolvible && elegidos.length > 0 && (
            <div className="vxp-card" style={{ marginTop: '1rem' }}>
              <h2 className="vxp-card-titulo">Registrar devolución</h2>
              <FormularioRegistroDevolucion
                motivos={motivos}
                motivoId={motivoId}
                onMotivo={(v) => {
                  setMotivoId(v)
                  if (v) setErrorMotivo(null)
                }}
                observaciones={observaciones}
                onObservaciones={setObservaciones}
                errorMotivo={errorMotivo}
                cantidadProductos={elegidos.length}
                monto={monto}
                tipo={tipo}
                registrando={registrando}
                onRegistrar={registrar}
              />
            </div>
          )}
        </div>
      )}
      </div>

      <ModalDevolucionRegistrada
        devolucion={registrada}
        onCerrar={() => {
          if (registrada) recordarDevolucion(registrada)
          setRegistrada(null)
        }}
      />
    </section>
  )
}

export default Devoluciones
