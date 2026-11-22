import { useCallback, useEffect, useRef, useState } from 'react'
import MarcoSimulacion from '../../components/simulacion/MarcoSimulacion.jsx'
import Icono from '../../components/ui/Icono.jsx'
import { useToast } from '../../components/ui/Toasts.jsx'
import { detalleDocumentoContabilidad, listarDocumentosContabilidad, responderContabilidad } from '../../api/simulacion.js'
import usePolling from '../../hooks/usePolling.js'
import { bs, fechaHora, hace, numero } from '../../utils/formato.js'

const ICONO_TIPO = { FACTURA_VENTA: 'factura', FACTURA_ANULACION: 'x', NOTA_CREDITO: 'devolucion', DIFERENCIA_CAJA: 'caja' }
const MOTIVOS = ['Cuenta contable inexistente', 'El monto no coincide con la factura', 'NIT del cliente inválido', 'Documento duplicado', 'Falta la glosa del asiento']

/** Ventana para rechazar: el motivo es obligatorio (así lo exige el mensaje resultado_documento). */
function ModalRechazo({ doc, enviando, onCancelar, onConfirmar }) {
  const [motivo, setMotivo] = useState('')
  const valido = motivo.trim().length >= 5
  return (
    <div className="sim-velo" role="dialog" aria-modal="true" aria-label="Rechazar documento" onMouseDown={(e) => e.target === e.currentTarget && onCancelar()}>
      <div className="sim-modal">
        <div className="sim-modal-cab">
          <h3>Rechazar {doc.referencia}</h3>
          <p>Contabilidad le dirá a Pagos y Facturación por qué no pudo registrar el asiento.</p>
        </div>
        <div className="sim-modal-cuerpo">
          <div className="sim-filtros">
            {MOTIVOS.map((m) => (
              <button key={m} type="button" className="sim-filtro" aria-pressed={motivo === m} onClick={() => setMotivo(m)}>{m}</button>
            ))}
          </div>
          <label className="sim-campo">
            <span>Motivo del rechazo</span>
            <textarea className="sim-entrada" value={motivo} maxLength={400} placeholder="Escribe el motivo o elige uno de arriba" onChange={(e) => setMotivo(e.target.value)} autoFocus />
          </label>
        </div>
        <div className="sim-modal-pie">
          <button type="button" className="sim-btn sim-btn--claro" onClick={onCancelar} disabled={enviando}>Cancelar</button>
          <button type="button" className="sim-btn sim-btn--bad" disabled={!valido || enviando} onClick={() => onConfirmar(motivo.trim())}>
            <Icono nombre="enviar" tam={17} /> {enviando ? 'Enviando…' : 'Rechazar y enviar a A1'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Que se esta aceptando o rechazando: lo que A1 le envio a Contabilidad (la factura completa, la nota de credito, la diferencia...). */
function ModalDetalle({ doc, token, bloqueado, onCerrar, onAceptar, onRechazar }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vigente = true
    detalleDocumentoContabilidad(doc.referencia, token)
      .then((r) => vigente && setD(r.data))
      .catch((e) => vigente && setError(e.message))
    return () => { vigente = false }
  }, [doc.referencia, token])

  const f = d?.factura
  // datos del mensaje enviado (notas de credito, lotes...): solo los campos simples, el resto queda en el JSON
  const campos = d?.datos && typeof d.datos === 'object'
    ? Object.entries(d.datos.datos && typeof d.datos.datos === 'object' ? { ...d.datos, ...d.datos.datos, datos: undefined } : d.datos).filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
    : []
  const extra = d?.extra ? Object.entries(d.extra).filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object') : []

  return (
    <div className="sim-velo" role="dialog" aria-modal="true" aria-label={`Detalle de ${doc.referencia}`} onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="sim-modal sim-modal--ancho">
        <div className="sim-modal-cab">
          <h3>{doc.referencia} <small className="sim-det-tipo">{doc.tipo_nombre}</small></h3>
          <p>Esto es lo que Pagos y Facturación le envió a Contabilidad. Revísalo antes de aceptar o rechazar.</p>
        </div>
        <div className="sim-modal-cuerpo">
          {error && <div className="sim-aviso sim-aviso--bad" role="alert">{error}</div>}
          {!d && !error && <div className="sim-lista"><div className="sim-esqueleto" /><div className="sim-esqueleto" /></div>}
          {d && (
            <>
              <dl className="sim-det-rejilla">
                <div><dt>Enviado</dt><dd>{fechaHora(d.enviado_en)} · {hace(d.enviado_en)}</dd></div>
                <div><dt>Desde</dt><dd>{d.servicio_origen}</dd></div>
                <div><dt>Estado</dt><dd>{d.estado}</dd></div>
                <div><dt>Message ID</dt><dd className="sim-det-mono">{d.message_id ?? '—'}</dd></div>
              </dl>

              {f && (
                <>
                  <dl className="sim-det-rejilla">
                    <div><dt>Cliente</dt><dd>{f.cliente_nombre ?? '—'}</dd></div>
                    <div><dt>NIT / CI</dt><dd>{f.cliente_nit ?? '—'}</dd></div>
                    <div><dt>Factura</dt><dd>{f.numero} · {f.estado}</dd></div>
                    <div><dt>Pago</dt><dd>{f.metodos_pago.map((p) => `${p.metodo} ${bs(p.monto)}`).join(' + ') || '—'}</dd></div>
                  </dl>
                  <table className="sim-det-tabla">
                    <thead><tr><th>Producto</th><th className="num">Cant.</th><th className="num">Precio</th><th className="num">Subtotal</th></tr></thead>
                    <tbody>
                      {f.items.map((it, i) => (
                        <tr key={i}><td>{it.descripcion}</td><td className="num">{numero(it.cantidad, Number.isInteger(it.cantidad) ? 0 : 2)}</td><td className="num">{bs(it.precio_unitario)}</td><td className="num">{bs(it.subtotal)}</td></tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td colSpan={3}>{d.tipo === 'FACTURA_ANULACION' ? 'Total que se anula' : 'Total'}</td><td className="num">{bs(f.total)}</td></tr></tfoot>
                  </table>
                  {d.tipo === 'FACTURA_ANULACION' && <p className="sim-det-nota">Es la anulación de esta factura: Contabilidad debe reversar el asiento de la venta.</p>}
                </>
              )}

              {!f && (campos.length > 0 || extra.length > 0) && (
                <dl className="sim-det-rejilla">
                  {[...campos, ...extra].map(([k, v]) => (
                    <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{String(v)}</dd></div>
                  ))}
                </dl>
              )}

              {d.datos && <details className="sim-det-json"><summary>Ver el mensaje completo</summary><pre>{JSON.stringify(d.datos, null, 2)}</pre></details>}
            </>
          )}
        </div>
        <div className="sim-modal-pie">
          <button type="button" className="sim-btn sim-btn--claro" onClick={onCerrar}>Cerrar</button>
          <button type="button" className="sim-btn sim-btn--bad" disabled={bloqueado} onClick={onRechazar}><Icono nombre="x" tam={17} /> Rechazar</button>
          <button type="button" className="sim-btn sim-btn--ok" disabled={bloqueado} onClick={onAceptar}><Icono nombre="check" tam={17} /> Aceptar</button>
        </div>
      </div>
    </div>
  )
}

function Contenido({ token }) {
  const toast = useToast()
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [enviados, setEnviados] = useState(() => new Map()) // referencia -> { resultado, motivo, asiento, tipo_nombre, ts, publicando }: lo que YA se respondio; nunca vuelve a la bandeja
  const [rechazando, setRechazando] = useState(null)
  const [detalle, setDetalle] = useState(null)
  const enVuelo = useRef(new Set()) // candado inmediato: una referencia no se responde dos veces aunque se haga clic de nuevo
  const montado = useRef(true)

  const cargar = useCallback(async () => {
    try {
      const r = await listarDocumentosContabilidad(token)
      if (montado.current) {
        setDatos(r.data)
        setError(null)
        // Si A1 volvio a enviar un documento que ya respondimos (por ejemplo lo reenviaron tras un rechazo) y ya pasó un buen rato, se puede responder otra vez.
        setEnviados((m) => {
          const vueltos = [...m.entries()].filter(([ref, e]) => !e.publicando && Date.now() - e.ts > 90000 && r.data.pendientes.some((p) => p.referencia === ref))
          if (!vueltos.length) return m
          const n = new Map(m)
          vueltos.forEach(([ref]) => n.delete(ref))
          return n
        })
      }
    } catch (e) {
      if (montado.current) setError(e.message)
    }
  }, [token])

  useEffect(() => {
    montado.current = true
    cargar()
    return () => { montado.current = false }
  }, [cargar])
  // mientras haya algo esperando a que A1 lo procese se consulta seguido; si no, de vez en cuando
  const esperando = [...enviados.entries()].some(([ref, e]) => e.publicando || !datos?.respondidos.some((d) => d.referencia === ref))
  usePolling(cargar, esperando ? 3000 : 10000)

  async function responder(doc, resultado, motivo) {
    const ref = doc.referencia
    if (enVuelo.current.has(ref) || enviados.has(ref)) return // ya se respondio: un solo mensaje por documento
    enVuelo.current.add(ref)
    setRechazando(null)
    setDetalle(null)
    // Pasa AL INSTANTE a "Respuestas enviadas a A1" (enviando...) y ya no puede volver a la bandeja ni responderse otra vez.
    setEnviados((m) => new Map(m).set(ref, { resultado, motivo, tipo_nombre: doc.tipo_nombre, ts: Date.now(), publicando: true }))
    try {
      const r = await responderContabilidad({ referencia: ref, resultado, motivo }, token)
      toast.ok(resultado === 'aceptado' ? `${ref} aceptado` : `${ref} rechazado`, `Publicado en Pub/Sub (${r.data.message_id}). A1 lo registra en unos segundos.`)
      setEnviados((m) => new Map(m).set(ref, { resultado, motivo, asiento: r.data.numero_asiento, tipo_nombre: doc.tipo_nombre, ts: Date.now(), publicando: false }))
    } catch (e) {
      if (e.status === 409) {
        // el servidor ya tenia una respuesta para este documento: se queda como enviado
        setEnviados((m) => new Map(m).set(ref, { resultado, motivo, tipo_nombre: doc.tipo_nombre, ts: Date.now(), publicando: false }))
        toast.aviso('Ya estaba respondido', e.message)
      } else {
        // no salio nada: vuelve a la bandeja para intentarlo de nuevo
        setEnviados((m) => { const n = new Map(m); n.delete(ref); return n })
        toast.error('No se pudo enviar la respuesta', e.message)
      }
    } finally {
      enVuelo.current.delete(ref)
    }
  }

  const pendientes = (datos?.pendientes ?? []).filter((d) => !enviados.has(d.referencia)) // lo ya respondido no vuelve a la bandeja
  const respondidosServidor = datos?.respondidos ?? []
  // la lista de resueltos mezcla lo que acabamos de enviar (aun esperando a A1) con lo que A1 ya registro
  const resueltos = [
    ...[...enviados.entries()].map(([referencia, e]) => ({ referencia, local: e, servidor: respondidosServidor.find((d) => d.referencia === referencia) })),
    ...respondidosServidor.filter((d) => !enviados.has(d.referencia)).map((d) => ({ referencia: d.referencia, servidor: d })),
  ].sort((a, b) => (b.local?.ts ?? 0) - (a.local?.ts ?? 0))

  return (
    <>
      <div className="sim-explica sim-entra">
        <span><Icono nombre="libro" tam={20} /></span>
        <p>
          Estás viendo <strong>lo que ve Contabilidad</strong>: los asientos que Pagos y Facturación le envió (facturas, anulaciones, notas de crédito y diferencias de caja).
          Al <strong>aceptar</strong> o <strong>rechazar</strong> se publica el resultado en Pub/Sub hacia el tópico de A1, igual que lo haría Contabilidad de verdad.
          Cuando vuelvas, esos documentos ya figuran como respondidos.
        </p>
      </div>

      <div className="sim-metricas sim-entra">
        <div className="sim-metrica" style={{ '--c': '#d4a017' }}><small>Por revisar</small><strong>{datos ? numero(pendientes.length) : '—'}</strong><span>asientos esperando respuesta</span></div>
        <div className="sim-metrica" style={{ '--c': '#12805c' }}><small>Resueltos</small><strong>{datos ? numero(resueltos.length) : '—'}</strong><span>respondidos a A1</span></div>
        <div className="sim-metrica" style={{ '--c': '#7a8699' }}><small>Aún sin salir</small><strong>{datos ? numero(datos.sin_enviar) : '—'}</strong><span>en cola o con error en A1</span></div>
      </div>

      {error && <div className="sim-aviso sim-aviso--bad" role="alert">No se pudo consultar a Pagos y Facturación: {error}</div>}
      {datos?.fuentes?.some((f) => !f.ok) && (
        <div className="sim-aviso sim-aviso--warn">Algunos servicios no respondieron ({datos.fuentes.filter((f) => !f.ok).map((f) => f.origen).join(', ')}): faltarán sus documentos en la lista.</div>
      )}

      <div className="sim-grid sim-grid--parejo sim-entra">
        <section className="sim-panel">
          <div className="sim-panel-cab">
            <h2><Icono nombre="bandeja" tam={20} /> Bandeja de Contabilidad</h2>
            <span className="sim-contador">{pendientes.length}</span>
          </div>
          <div className="sim-panel-cuerpo sim-panel-cuerpo--lista">
            {!datos ? (
              <div className="sim-lista"><div className="sim-esqueleto" /><div className="sim-esqueleto" /></div>
            ) : pendientes.length === 0 ? (
              <div className="sim-vacio">
                <span><Icono nombre="checkCirculo" tam={28} /></span>
                <b>Bandeja al día</b>
                Contabilidad no tiene asientos por resolver. Emite una factura en caja y vuelve a entrar.
              </div>
            ) : (
              <ul className="sim-lista">
                {pendientes.map((d) => (
                  <li
                    key={d.referencia}
                    className="sim-fila sim-fila--clic"
                    role="button"
                    tabIndex={0}
                    aria-label={`Ver el detalle de ${d.referencia}`}
                    onClick={() => setDetalle(d)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetalle(d) } }}
                  >
                    <span className="sim-icono"><Icono nombre={ICONO_TIPO[d.tipo] ?? 'factura'} tam={22} /></span>
                    <div>
                      <b>{d.referencia}</b>
                      <small>{d.tipo_nombre} · enviada {hace(d.fecha)}</small>
                    </div>
                    <div className="sim-acciones" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <button type="button" className="sim-btn sim-btn--claro" onClick={() => setDetalle(d)}>
                        <Icono nombre="info" tam={17} /> Ver detalle
                      </button>
                      <button type="button" className="sim-btn sim-btn--ok" onClick={() => responder(d, 'aceptado')}>
                        <Icono nombre="check" tam={17} /> Aceptar
                      </button>
                      <button type="button" className="sim-btn sim-btn--bad" onClick={() => setRechazando(d)}>
                        <Icono nombre="x" tam={17} /> Rechazar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="sim-panel">
          <div className="sim-panel-cab">
            <h2><Icono nombre="enviar" tam={20} /> Respuestas enviadas a A1</h2>
            <span className="sim-contador">{resueltos.length}</span>
          </div>
          <div className="sim-panel-cuerpo sim-panel-cuerpo--lista">
            {resueltos.length === 0 ? (
              <div className="sim-vacio">
                <span><Icono nombre="bandeja" tam={26} /></span>
                <b>Aún no respondiste nada</b>
                Acepta o rechaza un asiento y aparecerá aquí con su estado.
              </div>
            ) : (
              <ul className="sim-lista">
                {resueltos.slice(0, 12).map(({ referencia, local, servidor }) => {
                  const resultado = servidor?.resultado ?? local?.resultado
                  const rechazado = resultado === 'rechazado'
                  const registrado = Boolean(servidor)
                  const publicando = Boolean(local?.publicando)
                  const motivo = servidor?.motivo ?? local?.motivo
                  const asiento = servidor?.numero_asiento ?? local?.asiento
                  return (
                    <li key={referencia} className={`sim-fila${local && Date.now() - local.ts < 1500 ? ' sim-fila--nueva' : ''}`}>
                      <span className="sim-icono" style={rechazado ? { color: '#a32626', background: '#fde8e8' } : { color: '#0b6b4c', background: '#e5f6ef' }}>
                        <Icono nombre={rechazado ? 'x' : 'check'} tam={22} />
                      </span>
                      <div>
                        <b>{referencia}</b>
                        <small>{rechazado ? `Rechazado: ${motivo ?? '—'}` : `Aceptado${asiento ? ` · asiento N° ${asiento}` : ''}`}</small>
                      </div>
                      {publicando
                        ? <span className="sim-chip sim-chip--warn sim-chip--espera"><i /> Enviando a Pub/Sub…</span>
                        : registrado
                          ? <span className="sim-chip sim-chip--ok"><Icono nombre="check" tam={13} /> A1 lo registró</span>
                          : <span className="sim-chip sim-chip--warn sim-chip--espera"><i /> A1 lo está procesando</span>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {detalle && (
        <ModalDetalle
          doc={detalle}
          token={token}
          bloqueado={enviados.has(detalle.referencia)}
          onCerrar={() => setDetalle(null)}
          onAceptar={() => responder(detalle, 'aceptado')}
          onRechazar={() => { setRechazando(detalle); setDetalle(null) }}
        />
      )}
      {rechazando && (
        <ModalRechazo doc={rechazando} enviando={false} onCancelar={() => setRechazando(null)} onConfirmar={(motivo) => responder(rechazando, 'rechazado', motivo)} />
      )}
    </>
  )
}

export default function VistaContabilidad() {
  return (
    <MarcoSimulacion vista="contabilidad" letra="D" titulo="Contabilidad" volverA="/admin/monitor-integraciones">
      {({ token }) => <Contenido token={token} />}
    </MarcoSimulacion>
  )
}
