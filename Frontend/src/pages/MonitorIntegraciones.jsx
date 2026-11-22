import { useCallback, useEffect, useRef, useState } from 'react'
import { listarMensajesIntegracion, obtenerResumenIntegraciones, reenviarMensajeIntegracion } from '../api/integraciones.js'
import { useAdminAuth } from '../context/AdminAuthContext.jsx'
import Boton from '../components/ui/Boton.jsx'
import Icono from '../components/ui/Icono.jsx'
import Drawer from '../components/ui/Drawer.jsx'
import { Aviso, Esqueleto, Vacio } from '../components/ui/Aviso.jsx'
import ModalReenvioRechazado from '../components/kpis/ModalReenvioRechazado.jsx'
import { useToast } from '../components/ui/Toasts.jsx'
import { fechaHora, hace } from '../utils/formato.js'

const REFRESCO_MS = 30000

export const GRUPOS = {
  C: { nombre: 'Compras', icono: 'camion', color: '#0f7a53' },
  E: { nombre: 'Marketplace', icono: 'globo', color: '#c05621' },
  D: { nombre: 'Contabilidad', icono: 'libro', color: '#315a91' },
}
const ORDEN_TARJETAS = ['C', 'E', 'D']
const ESTADOS = ['Enviado', 'Respondido', 'Pendiente', 'Error']
const TONO = { Enviado: 'info', Respondido: 'ok', Pendiente: 'warn', Error: 'bad' }

function Insignia({ estado }) {
  const tono = TONO[estado]
  return (
    <span
      className={`vxp-badge${tono === 'info' ? '' : ` vxp-badge--${tono}`}${estado === 'Pendiente' ? ' vxp-badge--vivo' : ''}`}
    >
      {estado}
    </span>
  )
}

/** TDSI-130: tarjeta de un grupo con sus totales por estado y una barra apilada con la proporcion de cada estado. */
function TarjetaGrupo({ grupo, activo, onClick }) {
  const g = GRUPOS[grupo.grupo]
  const partes = [
    { clave: 'respondidos', etiqueta: 'Respondidos', color: 'var(--vxp-ok)' },
    { clave: 'enviados', etiqueta: 'Enviados', color: 'var(--vx-sky)' },
    { clave: 'pendientes', etiqueta: 'Pendientes', color: 'var(--vxp-warn)' },
    { clave: 'errores', etiqueta: 'Con error', color: 'var(--vxp-bad)' },
  ]
  return (
    <button
      type="button"
      className="vxp-card vxp-card--interactiva"
      onClick={onClick}
      aria-pressed={activo}
      style={{ textAlign: 'left', font: 'inherit', borderColor: activo ? g.color : undefined, boxShadow: activo ? `0 0 0 3px ${g.color}22, var(--vxp-sombra)` : undefined, margin: 0 }}
    >
      <div className="vxp-fila vxp-fila--entre" style={{ marginBottom: 10 }}>
        <span className="vxp-fila" style={{ gap: 10 }}>
          <span className="vxp-modal-icono" style={{ background: `${g.color}18`, color: g.color, width: 38, height: 38 }}>
            <Icono nombre={g.icono} tam={19} />
          </span>
          <strong style={{ color: 'var(--vx-navy)', fontFamily: 'var(--font-display)' }}>{g.nombre}</strong>
        </span>
        {grupo.errores > 0 ? (
          <span className="vxp-badge vxp-badge--bad vxp-badge--vivo">{grupo.errores} con error</span>
        ) : (
          <span className="vxp-badge vxp-badge--ok">Sin errores</span>
        )}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--vx-navy)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {grupo.total}
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--vxp-texto-suave)', marginLeft: 6 }}>mensajes</span>
      </div>
      <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', background: '#eef1f6', margin: '12px 0 10px' }}>
        {partes.map((p) =>
          grupo[p.clave] > 0 ? <span key={p.clave} style={{ width: `${(grupo[p.clave] / Math.max(grupo.total, 1)) * 100}%`, background: p.color }} /> : null,
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {partes.map((p) => (
          <div key={p.clave}>
            <div style={{ fontSize: '1.05rem', fontWeight: 750, color: 'var(--vx-navy)', fontVariantNumeric: 'tabular-nums' }}>{grupo[p.clave]}</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--vxp-texto-suave)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: p.color }} />
              {p.etiqueta}
            </div>
          </div>
        ))}
      </div>
    </button>
  )
}

/**
 * TDSI-125: "Monitor de integraciones": tres tarjetas por grupo (TDSI-130), tabla de todos los mensajes con filtros por grupo,
 * estado y fecha y el panel "Ver contenido" (TDSI-131), "Reenviar" en los mensajes con Error y actualizacion cada 30 s (TDSI-132).
 */
function MonitorIntegraciones() {
  const { administrador } = useAdminAuth()
  const token = administrador?.access_token
  const toast = useToast()

  const [resumen, setResumen] = useState(null)
  const [mensajes, setMensajes] = useState({ data: [], total: 0, total_paginas: 1, fuentes: [] })
  const [filtros, setFiltros] = useState({ grupo: '', estado: '', desde: '', hasta: '' })
  const [pagina, setPagina] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [abierto, setAbierto] = useState(null)
  const [reenviando, setReenviando] = useState(null)
  const [actualizadoEn, setActualizadoEn] = useState(null)
  const [, setTic] = useState(0)
  const filtrosRef = useRef(filtros)
  filtrosRef.current = filtros

  const cargar = useCallback(
    async ({ silencioso = false } = {}) => {
      if (!token) return
      if (!silencioso) setCargando(true)
      try {
        const [r, m] = await Promise.all([obtenerResumenIntegraciones(token), listarMensajesIntegracion({ ...filtrosRef.current, pagina }, token)])
        setResumen(r.data)
        setMensajes({ data: m.data, total: m.total, total_paginas: m.total_paginas, fuentes: m.fuentes ?? [] })
        setActualizadoEn(new Date())
        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        setCargando(false)
      }
    },
    [token, pagina],
  )

  useEffect(() => {
    cargar()
  }, [cargar, filtros])

  // TDSI-132: la pantalla se actualiza sola cada 30 s (pausada con la pestaña oculta).
  useEffect(() => {
    const t = setInterval(() => !document.hidden && cargar({ silencioso: true }), REFRESCO_MS)
    const r = setInterval(() => setTic((n) => n + 1), 5000)
    return () => {
      clearInterval(t)
      clearInterval(r)
    }
  }, [cargar])

  function cambiarFiltro(campo, valor) {
    setPagina(1)
    setFiltros((f) => ({ ...f, [campo]: valor }))
  }

  const [justificando, setJustificando] = useState(null) // mensaje RECHAZADO por Contabilidad que se esta por reenviar

  const esRechazado = (m) => String(m.detalle?.resultado ?? '').toLowerCase() === 'rechazado'

  async function reenviar(m, e, justificacion) {
    e?.stopPropagation()
    // lo que Contabilidad rechazo no se reenvia solo: primero se escribe como se resolvio
    if (esRechazado(m) && justificacion === undefined) {
      setJustificando(m)
      return
    }
    setReenviando(m.id + m.origen)
    try {
      const r = await reenviarMensajeIntegracion({ ...m, justificacion }, token)
      setJustificando(null)
      if (r.data?.estado === 'Error') toast.error('El reenvío volvió a fallar', r.data.error ?? r.mensaje)
      else toast.ok('Mensaje reenviado', `${m.tipo} · ${m.referencia ?? m.id} · messageId ${r.data?.message_id ?? 'nuevo'}`)
      if (abierto && abierto.id === m.id && abierto.origen === m.origen && r.data?.estado) setAbierto(r.data)
      await cargar({ silencioso: true })
    } catch (err) {
      toast.error('No se pudo reenviar', err.message)
    } finally {
      setReenviando(null)
    }
  }

  const fuentesCaidas = mensajes.fuentes.filter((f) => !f.ok)
  const confirmarJustificacion = (texto) => reenviar(justificando, undefined, texto)
  const grupos = resumen ? ORDEN_TARJETAS.map((g) => resumen.grupos.find((x) => x.grupo === g)).filter(Boolean) : []

  return (
    <section>
      <header className="vxp-hero">
        <div className="vxp-hero-titulo">
          <span className="vxp-hero-icono">
            <Icono nombre="rayo" tam={24} />
          </span>
          <div>
            <h1>Monitor de integraciones</h1>
            <p>Todos los mensajes con Compras, Marketplace y Contabilidad en un solo lugar.</p>
          </div>
        </div>
        <div className="vxp-hero-acciones" style={{ alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem', color: 'rgba(223,232,245,.85)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="vxp-badge vxp-badge--ok vxp-badge--vivo" style={{ background: 'rgba(25,168,116,.2)', color: '#7ee2b8', borderColor: 'transparent' }}>
              En vivo
            </span>
            {actualizadoEn ? `Actualizado ${hace(actualizadoEn)}` : 'Cargando...'}
          </span>
          <Boton variante="vidrio" icono="recargar" onClick={() => cargar()} cargando={cargando && Boolean(resumen)}>
            Actualizar
          </Boton>
        </div>
      </header>

      {fuentesCaidas.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <Aviso tono="warn" titulo="Algunos servicios no respondieron">
            {fuentesCaidas.map((f) => f.origen).join(', ')}: se muestran los mensajes de los demás.
          </Aviso>
        </div>
      )}

      {!resumen && cargando ? (
        <div className="vxp-grid vxp-grid--3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="vxp-card" style={{ margin: 0 }}>
              <Esqueleto filas={4} alto={20} />
            </div>
          ))}
        </div>
      ) : (
        <div className="vxp-grid vxp-grid--3 vxp-escalon">
          {grupos.map((g) => (
            <TarjetaGrupo key={g.grupo} grupo={g} activo={filtros.grupo === g.grupo} onClick={() => cambiarFiltro('grupo', filtros.grupo === g.grupo ? '' : g.grupo)} />
          ))}
        </div>
      )}

      <div className="vxp-card" style={{ marginTop: '1rem' }}>
        <h2 className="vxp-card-titulo">
          Mensajes
          <small>{mensajes.total} en total</small>
        </h2>
        <div className="vxp-filtros" style={{ marginBottom: '1rem' }}>
          <label className="vxp-campo">
            Grupo
            <select value={filtros.grupo} onChange={(e) => cambiarFiltro('grupo', e.target.value)}>
              <option value="">Todos</option>
              {ORDEN_TARJETAS.map((g) => (
                <option key={g} value={g}>
                  {GRUPOS[g].nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="vxp-campo">
            Estado
            <select value={filtros.estado} onChange={(e) => cambiarFiltro('estado', e.target.value)}>
              <option value="">Todos</option>
              {ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="vxp-campo">
            Desde
            <input type="date" value={filtros.desde} onChange={(e) => cambiarFiltro('desde', e.target.value)} />
          </label>
          <label className="vxp-campo">
            Hasta
            <input type="date" value={filtros.hasta} onChange={(e) => cambiarFiltro('hasta', e.target.value)} />
          </label>
        </div>

        {error && <Aviso tono="bad" titulo="No se pudo cargar el monitor">{error}</Aviso>}

        {cargando && mensajes.data.length === 0 ? (
          <Esqueleto filas={6} alto={24} />
        ) : mensajes.data.length === 0 && !error ? (
          <Vacio icono="bandeja" titulo="Sin mensajes">
            No hay mensajes con esos filtros.
          </Vacio>
        ) : (
          <>
            <div className="vxp-tabla-envoltura">
              <table className="vxp-tabla">
                <thead>
                  <tr>
                    <th>Grupo</th>
                    <th>Tipo de mensaje</th>
                    <th>Referencia</th>
                    <th>Fecha y hora</th>
                    <th>Estado</th>
                    <th>messageId</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {mensajes.data.map((m) => {
                    const g = GRUPOS[m.grupo] ?? { nombre: m.grupo, icono: 'info', color: '#5b6676' }
                    const clave = m.id + m.origen
                    return (
                      <tr key={clave} className="vxp-fila--clic" onClick={() => setAbierto(m)}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 650, color: g.color }}>
                            <Icono nombre={g.icono} tam={15} /> {g.nombre}
                          </span>
                        </td>
                        <td className="vxp-codigo" style={{ fontSize: '0.8rem' }}>{m.tipo}</td>
                        <td className="vxp-codigo" style={{ fontSize: '0.8rem' }}>{m.referencia ?? '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fechaHora(m.fecha)}</td>
                        <td>
                          <Insignia estado={m.estado} />
                        </td>
                        <td className="vxp-codigo" style={{ fontSize: '0.75rem', color: 'var(--vxp-texto-suave)' }} title={m.message_id ?? ''}>
                          {m.message_id ? `${String(m.message_id).slice(0, 12)}${String(m.message_id).length > 12 ? '…' : ''}` : '—'}
                        </td>
                        <td>
                          <div className="vxp-fila vxp-fila--fin" style={{ flexWrap: 'nowrap' }}>
                            <Boton variante="fantasma" tam="sm" icono="ojo" onClick={(e) => { e.stopPropagation(); setAbierto(m) }}>
                              Ver contenido
                            </Boton>
                            {m.puede_reenviar && (
                              <Boton variante="peligro" tam="sm" icono="recargar" cargando={reenviando === clave} onClick={(e) => reenviar(m, e)}>
                                Reenviar
                              </Boton>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="vxp-paginacion">
              <span>
                Página {pagina} de {mensajes.total_paginas}
              </span>
              <div className="vxp-fila">
                <Boton variante="claro" tam="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                  Anterior
                </Boton>
                <Boton variante="claro" tam="sm" disabled={pagina >= mensajes.total_paginas} onClick={() => setPagina((p) => p + 1)}>
                  Siguiente
                </Boton>
              </div>
            </div>
          </>
        )}
      </div>

      <Drawer
        abierto={Boolean(abierto)}
        onCerrar={() => setAbierto(null)}
        titulo={abierto ? `${abierto.tipo}` : ''}
        subtitulo={abierto ? `${GRUPOS[abierto.grupo]?.nombre ?? abierto.grupo} · ${abierto.referencia ?? abierto.id} · ${fechaHora(abierto.fecha)}` : ''}
      >
        {abierto && (
          <div style={{ display: 'grid', gap: '1rem' }}>
            <dl className="vxp-datos">
              <div className="vxp-dato">
                <dt>Estado</dt>
                <dd>
                  <Insignia estado={abierto.estado} />
                </dd>
              </div>
              <div className="vxp-dato">
                <dt>Intentos</dt>
                <dd>{abierto.intentos ?? '—'}</dd>
              </div>
              <div className="vxp-dato" style={{ gridColumn: '1 / -1' }}>
                <dt>messageId</dt>
                <dd className="vxp-codigo" style={{ fontSize: '0.82rem' }}>{abierto.message_id ?? '—'}</dd>
              </div>
            </dl>
            {abierto.error && <Aviso tono="bad" titulo="Último error">{abierto.error}</Aviso>}
            {abierto.puede_reenviar && (
              <Boton variante="peligro" icono="recargar" cargando={reenviando === abierto.id + abierto.origen} onClick={() => reenviar(abierto)}>
                Reenviar mensaje
              </Boton>
            )}
            <div>
              <h3 className="vxp-card-titulo" style={{ fontSize: '0.92rem' }}>Contenido del mensaje</h3>
              <pre
                style={{
                  margin: 0,
                  padding: '0.9rem 1rem',
                  borderRadius: 12,
                  background: '#0b1220',
                  color: '#d6e2f5',
                  fontSize: '0.78rem',
                  lineHeight: 1.55,
                  overflow: 'auto',
                  maxHeight: '48vh',
                  fontFamily: "'JetBrains Mono', Consolas, monospace",
                }}
              >
                {JSON.stringify(abierto.datos ?? abierto.detalle ?? {}, null, 2)}
              </pre>
              {abierto.datos == null && Object.keys(abierto.detalle ?? {}).length > 0 && (
                <p className="vxp-texto-suave" style={{ fontSize: '0.78rem' }}>Este servicio solo expone el detalle del envío.</p>
              )}
            </div>
          </div>
        )}
      </Drawer>
      {justificando && (
        <ModalReenvioRechazado
          asiento={{ referencia: justificando.referencia ?? justificando.id, motivo: justificando.detalle?.motivo ?? justificando.detalle?.motivo_rechazo }}
          enviando={reenviando === justificando.id + justificando.origen}
          onCancelar={() => setJustificando(null)}
          onConfirmar={confirmarJustificacion}
        />
      )}
    </section>
  )
}

export default MonitorIntegraciones
