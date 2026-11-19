import { useEffect, useState } from 'react'
import { listarGruposPubSub, listarVerificacionesPubSub, enviarVerificacionPubSub } from '../api/pubsubVerificacion.js'
import { useAdminAuth } from '../context/AdminAuthContext.jsx'
import Cargando from '../components/Cargando.jsx'

const LARGO_MAXIMO_MENSAJE = 2000

// TDSI-958: "Verificación de Pub/Sub" -- mandar un mensaje cualquiera a cualquiera
// de los tópicos de los grupos del proyecto compartido (A-I), para saber con
// quién hay conexión real y con quién no, con un log de cada intento.
function PubSubVerificacion() {
  const { administrador } = useAdminAuth()

  const [grupos, setGrupos] = useState([])
  const [cargandoGrupos, setCargandoGrupos] = useState(true)
  const [errorGrupos, setErrorGrupos] = useState(null)

  // TDSI-963: de qué grupo se simula que viene el mensaje (A por defecto, el real).
  const [grupoOrigen, setGrupoOrigen] = useState('A')
  const [grupo, setGrupo] = useState('')
  // TDSI-962: para descartar si un envio que falla es culpa del topico o de nuestro
  // codigo, se puede mandar a un topico cualquiera en vez de a uno de los grupos
  // conocidos (Pub/Sub no tiene "topico de origen": publicar siempre es hacia un
  // destino, nunca "desde" uno -- esto reemplaza el selector de grupo por ese destino).
  const [usarTopicoPersonalizado, setUsarTopicoPersonalizado] = useState(false)
  const [topicoPersonalizado, setTopicoPersonalizado] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)
  const [ultimoResultado, setUltimoResultado] = useState(null)

  const [log, setLog] = useState([])
  const [cargandoLog, setCargandoLog] = useState(true)
  const [errorLog, setErrorLog] = useState(null)
  // TDSI-958: cada entrada del historial se puede expandir para ver el contenido
  // completo que se mandó (igual que el "Ver contenido enviado" de otros grupos),
  // asi es facil identificarle al docente exactamente cual mensaje es cual.
  const [expandidos, setExpandidos] = useState(new Set())

  function alternarExpandido(id) {
    setExpandidos((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  useEffect(() => {
    listarGruposPubSub()
      .then((r) => {
        setGrupos(r.data)
        setGrupo(r.data[0]?.grupo ?? '')
      })
      .catch((err) => setErrorGrupos(err.message))
      .finally(() => setCargandoGrupos(false))
  }, [])

  function cargarLog() {
    setCargandoLog(true)
    listarVerificacionesPubSub()
      .then((r) => {
        setLog(r.data)
        setErrorLog(null)
      })
      .catch((err) => setErrorLog(err.message))
      .finally(() => setCargandoLog(false))
  }

  useEffect(() => {
    cargarLog()
  }, [])

  async function enviar(event) {
    event.preventDefault()
    if (usarTopicoPersonalizado ? !topicoPersonalizado.trim() : !grupo) return
    if (!mensaje.trim()) {
      setError('Escribe un mensaje para enviar.')
      return
    }
    setEnviando(true)
    setError(null)
    setUltimoResultado(null)
    try {
      const { data } = await enviarVerificacionPubSub({
        grupo_origen: grupoOrigen,
        ...(usarTopicoPersonalizado ? { topico_personalizado: topicoPersonalizado.trim() } : { grupo }),
        mensaje: mensaje.trim(),
        enviado_por: administrador?.email,
      })
      setUltimoResultado(data)
      setLog((prev) => [data, ...prev])
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section>
      <h1>Verificación de Pub/Sub</h1>
      <p className="resumen-turno-actual">
        Manda cualquier mensaje al tópico de otro grupo del proyecto para comprobar si hay conexión real.
        Lo que llega como "Enviado" quedó aceptado por Google Pub/Sub; que el otro grupo lo haya
        recibido de verdad solo se confirma con ellos (o revisando su suscripción en la consola de GCP).
        El "Tópico origen" es solo para nuestras propias pruebas (en la vida real siempre somos el
        Grupo A); y si sospechas que un tópico puntual está fallando, usa el tópico personalizado
        para probar otro distinto y así distinguir si el problema es ese tópico o nuestro código.
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 1rem', fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={usarTopicoPersonalizado}
          onChange={(e) => setUsarTopicoPersonalizado(e.target.checked)}
        />
        Usar un tópico personalizado (para descartar si el problema es el tópico o nuestro código)
      </label>

      <form className="filtro-fechas" onSubmit={enviar} style={{ alignItems: 'flex-start' }}>
        <label className="campo" title="En la vida real siempre somos el Grupo A -- esto solo sirve para simular, en nuestras propias pruebas, que el mensaje viene de otro grupo.">
          Tópico origen
          <select value={grupoOrigen} onChange={(e) => setGrupoOrigen(e.target.value)} disabled={cargandoGrupos}>
            {cargandoGrupos && <option value="">Cargando...</option>}
            {grupos.map((g) => (
              <option key={g.grupo} value={g.grupo}>
                {g.grupo} · {g.nombre}
              </option>
            ))}
          </select>
        </label>

        {usarTopicoPersonalizado ? (
          <label className="campo">
            Tópico (projects/&lt;proyecto&gt;/topics/&lt;tópico&gt;)
            <input
              type="text"
              value={topicoPersonalizado}
              onChange={(e) => setTopicoPersonalizado(e.target.value)}
              placeholder="projects/project-a96e5fe1-5ba6-4698-a85/topics/mi-topico-de-prueba"
              style={{ minWidth: '320px' }}
            />
          </label>
        ) : (
          <label className="campo">
            Tópico destino
            <select value={grupo} onChange={(e) => setGrupo(e.target.value)} disabled={cargandoGrupos}>
              {cargandoGrupos && <option value="">Cargando...</option>}
              {grupos.map((g) => (
                <option key={g.grupo} value={g.grupo}>
                  {g.grupo} · {g.nombre}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="campo" style={{ flex: '1 1 320px' }}>
          Mensaje
          <textarea
            rows={3}
            maxLength={LARGO_MAXIMO_MENSAJE}
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            placeholder="Cualquier texto: un saludo corto, HTML, lo que quieras probar"
          />
        </label>

        <button type="submit" className="btn" disabled={enviando || (!usarTopicoPersonalizado && cargandoGrupos)}>
          {enviando ? 'Enviando...' : 'Enviar'}
        </button>
      </form>

      {errorGrupos && <p className="error">No se pudieron cargar los grupos: {errorGrupos}</p>}
      {error && <p className="error">{error}</p>}

      {ultimoResultado && (
        <p className={ultimoResultado.ok ? 'mensaje-exito' : 'error'}>
          {ultimoResultado.ok
            ? `Enviado al tópico de ${ultimoResultado.grupo} (messageId: ${ultimoResultado.message_id}).`
            : `No se pudo enviar al tópico de ${ultimoResultado.grupo}: ${ultimoResultado.error}`}
        </p>
      )}

      <h2 style={{ marginTop: '2rem' }}>Historial de envíos</h2>

      {cargandoLog && <Cargando />}
      {errorLog && <p className="error">Error: {errorLog}</p>}

      {!cargandoLog && !errorLog && log.length === 0 && <p>Todavía no enviaste ninguna verificación.</p>}

      {log.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {log.map((r) => {
            const expandido = expandidos.has(r.id)
            const nombreGrupo = grupos.find((g) => g.grupo === r.grupo)?.nombre
            const nombreOrigen = grupos.find((g) => g.grupo === r.grupo_origen)?.nombre
            return (
              <div key={r.id} style={{ padding: '1rem 1.25rem', border: '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <strong>
                    {r.grupo_origen ? `Grupo ${r.grupo_origen}${nombreOrigen ? ` (${nombreOrigen})` : ''} → ` : ''}
                    {r.grupo === 'CUSTOM' ? 'Tópico personalizado' : `Grupo ${r.grupo}`}
                    {nombreGrupo ? ` · ${nombreGrupo}` : ''}
                  </strong>
                  {r.ok ? (
                    <span className="badge-estado badge-estado--emitida">Enviado</span>
                  ) : (
                    <span className="badge-estado badge-comparacion--faltante">No llegó</span>
                  )}
                </div>

                <p style={{ margin: '0.35rem 0', color: '#616e7c', fontSize: '0.85rem' }}>
                  {new Date(r.creado_en).toLocaleString()}
                  {r.ok ? ` · Message ID: ${r.message_id}` : ` · Error: ${r.error}`}
                  {r.enviado_por ? ` · Enviado por: ${r.enviado_por}` : ''}
                </p>
                <p style={{ margin: '0 0 0.5rem', color: '#616e7c', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                  Tópico: {r.topico}
                </p>

                <button
                  type="button"
                  onClick={() => alternarExpandido(r.id)}
                  style={{ padding: 0, border: 'none', background: 'none', color: 'var(--color-brand-dark)', fontWeight: 600, cursor: 'pointer' }}
                >
                  {expandido ? '▲ Ocultar contenido enviado' : '▼ Ver contenido enviado'}
                </button>

                {expandido && (
                  <pre
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.75rem',
                      backgroundColor: '#f4f6fa',
                      borderRadius: '8px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: '0.85rem',
                    }}
                  >
                    {/* TDSI-960: se muestra el cuerpo JSON exacto que se publico (con
                        llaves y comillas), no solo el texto libre que se escribio. */}
                    {JSON.stringify(r.payload_enviado ?? r.mensaje, null, 2)}
                  </pre>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default PubSubVerificacion
