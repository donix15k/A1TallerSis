import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext.jsx'
import { listarGruposPubSub } from '../api/pubsubVerificacion.js'
import { activarEspejo, desactivarEspejo, leerEspejo } from '../api/simulacion.js'
import { irConRecarga } from '../components/simulacion/MarcoSimulacion.jsx'
import Icono from '../components/ui/Icono.jsx'
import { useToast } from '../components/ui/Toasts.jsx'
import usePolling from '../hooks/usePolling.js'
import { fechaHora } from '../utils/formato.js'
import '../styles/simulacion.css'

const GRUPOS_SIMULABLES = [
  {
    vista: 'contabilidad', letra: 'D', titulo: 'Contabilidad', topico: 'ucb-sis323-sub-d',
    puntos: ['Ver los asientos que le enviamos: facturas, anulaciones, notas de crédito y diferencias de caja', 'Aceptarlos (con su N° de asiento) o rechazarlos con un motivo', 'Pagos y Facturación los marca como registrados o rechazados'],
  },
  {
    vista: 'marketplace', letra: 'E', titulo: 'Marketplace y Ventas', topico: 'ucb-sis323-sub-e',
    puntos: ['Elegir los productos y cantidades de un pedido online', 'Enviar la venta por Pub/Sub al grupo A1', 'Se factura y aparece en Ventas online al volver'],
  },
  {
    vista: 'compras', letra: 'C', titulo: 'Compras y Proveedores', topico: 'ucb-sis323-sub-c',
    puntos: ['Confirmar la recepción de nuestro reporte de productos vendidos', 'Entregar órdenes de pago aprobadas a Pagos a Proveedores', 'Los reportes pasan a Recibido y las órdenes llegan a la bandeja'],
  },
]

function TarjetaGrupo({ g }) {
  return (
    <article className={`simc-tarjeta simc-tarjeta--${g.vista}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="simc-letra">{g.letra}</span>
        <div>
          <h2>{g.titulo}</h2>
          <small>Grupo {g.letra}</small>
        </div>
      </div>
      <ul>
        {g.puntos.map((p) => (
          <li key={p}><Icono nombre="checkCirculo" tam={17} /> {p}</li>
        ))}
      </ul>
      <div className="simc-topico">Tópico del grupo: <code>{g.topico}</code></div>
      <button type="button" className="simc-ir" onClick={() => irConRecarga(`/simulacion/${g.vista}`)}>
        Ver desde {g.titulo.split(' ')[0]} <Icono nombre="flecha" tam={19} />
      </button>
    </article>
  )
}

/** Leer lo que llega a un tópico: Pub/Sub solo deja leer suscripciones, asi que se crea un "espejo" propio de A1 (vida corta, se vacía al leer). */
function EspejoTopicos() {
  const { administrador } = useAdminAuth()
  const token = administrador?.access_token
  const toast = useToast()
  const [grupos, setGrupos] = useState([])
  const [grupo, setGrupo] = useState('F')
  const [estado, setEstado] = useState('inactivo') // inactivo | activo
  const [mensajes, setMensajes] = useState([])
  const [ocupado, setOcupado] = useState(null)
  const [auto, setAuto] = useState(false)
  const [ultimaLectura, setUltimaLectura] = useState(null)
  const montado = useRef(true)

  useEffect(() => {
    montado.current = true
    listarGruposPubSub().then((r) => montado.current && setGrupos(r.data)).catch(() => {})
    return () => { montado.current = false }
  }, [])

  const topico = grupos.find((g) => g.grupo === grupo)?.topico

  async function ejecutar(nombre, fn, mensajeOk) {
    setOcupado(nombre)
    try {
      const r = await fn()
      if (mensajeOk) toast.ok(mensajeOk(r.data))
      return r.data
    } catch (e) {
      toast.error('No se pudo completar la acción', e.message)
      setAuto(false)
      return null
    } finally {
      setOcupado(null)
    }
  }

  async function activar() {
    const d = await ejecutar('activar', () => activarEspejo(grupo, token), (x) => (x.nuevo ? `Espejo del grupo ${grupo} activado` : `El espejo del grupo ${grupo} ya estaba activo`))
    if (d) { setEstado('activo'); setMensajes([]) }
  }
  async function leer(silencioso = false) {
    try {
      const r = await leerEspejo(grupo, token)
      if (!montado.current) return
      setUltimaLectura(new Date().toISOString())
      if (!r.data.activo) { setEstado('inactivo'); setAuto(false); if (!silencioso) toast.aviso('El espejo no está activo', 'Actívalo primero: solo verás lo que se publique después.'); return }
      setEstado('activo')
      if (r.data.mensajes.length) setMensajes((m) => [...r.data.mensajes, ...m].slice(0, 60))
      else if (!silencioso) toast.aviso('Sin mensajes nuevos', 'Todavía no llegó nada a este tópico desde que se activó el espejo.')
    } catch (e) {
      setAuto(false)
      toast.error('No se pudo leer el tópico', e.message)
    }
  }
  async function desactivar() {
    const d = await ejecutar('desactivar', () => desactivarEspejo(grupo, token), () => `Espejo del grupo ${grupo} eliminado`)
    if (d) { setEstado('inactivo'); setAuto(false) }
  }

  usePolling(() => leer(true), 5000, auto && estado === 'activo')

  return (
    <section className="simc-espejo">
      <div className="simc-espejo-cab">
        <h2><Icono nombre="ojo" tam={22} /> Leer lo que llega a un tópico</h2>
        <p>
          Pub/Sub no permite leer un tópico directamente; solo las <strong>suscripciones</strong> de ese tópico. Al activar el espejo, A1 crea una suscripción <strong>propia</strong> sobre el tópico elegido:
          es una copia independiente (no le quita nada al otro grupo), <strong>se vacía cada vez que lees</strong>, guarda como máximo 10 minutos y se borra sola al día. Solo verás lo que se publique <em>después</em> de activarla.
        </p>
      </div>
      <div className="simc-espejo-cuerpo">
        <div className="sim-aviso sim-aviso--warn">Para crear el espejo la cuenta de servicio de A1 necesita el rol <strong>Pub/Sub Editor</strong> en el proyecto. Si todavía no lo tiene, al activar verás el mensaje de permiso denegado: se lo debe otorgar el dueño del proyecto. Mientras tanto <strong>sí se puede publicar</strong> a cualquier tópico, pero no leer los de otros grupos.</div>
        <ol className="simc-pasos">
          <li>Elige el grupo y pulsa <b>Activar espejo</b>.</li>
          <li>Publica un mensaje a ese tópico (por ejemplo desde <Link to="/admin/pubsub-verificacion">Verificación de Pub/Sub</Link>, o una de las vistas de arriba).</li>
          <li>Pulsa <b>Leer ahora</b> (o activa la lectura automática) para ver qué llegó.</li>
        </ol>
        <div className="simc-barra">
          <label>
            Grupo
            <select value={grupo} onChange={(e) => { setGrupo(e.target.value); setEstado('inactivo'); setMensajes([]); setAuto(false) }}>
              {grupos.map((g) => <option key={g.grupo} value={g.grupo}>{g.grupo} · {g.nombre}</option>)}
            </select>
          </label>
          <button type="button" className="sim-btn" style={{ '--sim': '#2f5a96' }} onClick={activar} disabled={ocupado !== null}>
            <Icono nombre={ocupado === 'activar' ? 'recargar' : 'rayo'} tam={17} className={ocupado === 'activar' ? 'sim-giro' : undefined} /> Activar espejo
          </button>
          <button type="button" className="sim-btn sim-btn--claro" onClick={() => leer(false)} disabled={ocupado !== null}><Icono nombre="recargar" tam={17} /> Leer ahora</button>
          <button type="button" className="sim-btn sim-btn--claro" onClick={() => setAuto((a) => !a)} disabled={estado !== 'activo'} aria-pressed={auto}>
            <Icono nombre="reloj" tam={17} /> {auto ? 'Lectura automática: sí' : 'Lectura automática: no'}
          </button>
          <button type="button" className="sim-btn sim-btn--bad" onClick={desactivar} disabled={ocupado !== null}><Icono nombre="x" tam={17} /> Eliminar espejo</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', color: '#64748b', fontSize: '0.85rem' }}>
          <span className={`sim-chip ${estado === 'activo' ? 'sim-chip--ok' : 'sim-chip--info'}`}>{estado === 'activo' ? 'Espejo activo' : 'Espejo inactivo'}</span>
          {topico && <code>{topico}</code>}
          {ultimaLectura && <span>Última lectura: {fechaHora(ultimaLectura)}</span>}
        </div>

        {mensajes.length === 0 ? (
          <div className="sim-vacio" style={{ color: '#64748b' }}>
            <span style={{ '--sim': '#2f5a96' }}><Icono nombre="bandeja" tam={26} /></span>
            <b>Aún no hay mensajes</b>
            {estado === 'activo' ? 'Publica algo en ese tópico y pulsa Leer ahora.' : 'Activa el espejo para empezar a escuchar el tópico.'}
          </div>
        ) : (
          <div className="simc-mensajes">
            {mensajes.map((m) => (
              <article key={m.message_id} className="simc-msg">
                <div className="simc-msg-cab">
                  <span><b>{m.json?.sistema_origen ?? 'Texto libre'}</b>{m.json?.tipo_operacion || m.json?.tipo_mensaje ? ` · ${m.json.tipo_operacion ?? m.json.tipo_mensaje}` : ''}</span>
                  <span>{m.publicado_en ? fechaHora(m.publicado_en) : ''} · {m.message_id}</span>
                </div>
                <pre>{m.json ? JSON.stringify(m.json, null, 2) : m.texto}</pre>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function SimulacionGrupos() {
  return (
    <div className="simc">
      <section className="simc-hero">
        <h1>Simulación de grupos</h1>
        <p>
          Cada integración necesita a otro grupo del otro lado. Aquí puedes <strong>ponerte en su lugar</strong>: entras a la vista de Contabilidad, del Marketplace o de Compras,
          envías lo que ellos enviarían —siempre por <strong>Pub/Sub real</strong>— y al volver Pagos y Facturación ya lo recibió, como si el otro grupo existiera.
        </p>
        <div className="simc-flujo" aria-label="Flujo de la simulación">
          <span className="nodo">Otro grupo (D, E o C)</span>
          <Icono nombre="flecha" tam={20} />
          <span className="nodo">Tópico de A1</span>
          <Icono nombre="flecha" tam={20} />
          <span className="nodo nodo--a1">Pagos y Facturación (A1)</span>
        </div>
      </section>

      <div className="simc-tarjetas">
        {GRUPOS_SIMULABLES.map((g) => <TarjetaGrupo key={g.vista} g={g} />)}
      </div>

      <EspejoTopicos />
    </div>
  )
}

export default SimulacionGrupos
