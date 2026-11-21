import { useCallback, useEffect, useRef, useState } from 'react'
import MarcoSimulacion from '../../components/simulacion/MarcoSimulacion.jsx'
import Icono from '../../components/ui/Icono.jsx'
import { useToast } from '../../components/ui/Toasts.jsx'
import { listarDocumentosContabilidad, responderContabilidad } from '../../api/simulacion.js'
import usePolling from '../../hooks/usePolling.js'
import { hace, numero } from '../../utils/formato.js'

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

function Contenido({ token }) {
  const toast = useToast()
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(null)
  const [enviando, setEnviando] = useState(null) // referencia que se esta enviando
  const [saliendo, setSaliendo] = useState(() => new Set())
  const [enviados, setEnviados] = useState(() => new Map()) // referencia -> { resultado, motivo, asiento, tipo_nombre, ts }
  const [rechazando, setRechazando] = useState(null)
  const montado = useRef(true)

  const cargar = useCallback(async () => {
    try {
      const r = await listarDocumentosContabilidad(token)
      if (montado.current) {
        setDatos(r.data)
        setError(null)
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
  const esperando = [...enviados.keys()].some((ref) => !datos?.respondidos.some((d) => d.referencia === ref))
  usePolling(cargar, esperando ? 3000 : 10000)

  async function responder(doc, resultado, motivo) {
    setEnviando(doc.referencia)
    try {
      const r = await responderContabilidad({ referencia: doc.referencia, resultado, motivo }, token)
      toast.ok(resultado === 'aceptado' ? `${doc.referencia} aceptado` : `${doc.referencia} rechazado`, `Publicado en Pub/Sub (${r.data.message_id}). A1 lo registra en unos segundos.`)
      setRechazando(null)
      setSaliendo((s) => new Set(s).add(doc.referencia))
      setTimeout(() => {
        setEnviados((m) => new Map(m).set(doc.referencia, { resultado, motivo, asiento: r.data.numero_asiento, tipo_nombre: doc.tipo_nombre, ts: Date.now() }))
        setDatos((d) => d && { ...d, pendientes: d.pendientes.filter((p) => p.referencia !== doc.referencia) })
        setSaliendo((s) => { const n = new Set(s); n.delete(doc.referencia); return n })
      }, 380)
    } catch (e) {
      toast.error('No se pudo enviar la respuesta', e.message)
    } finally {
      setEnviando(null)
    }
  }

  const pendientes = datos?.pendientes ?? []
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
                  <li key={d.referencia} className={`sim-fila${saliendo.has(d.referencia) ? ' sim-fila--sale' : ''}`}>
                    <span className="sim-icono"><Icono nombre={ICONO_TIPO[d.tipo] ?? 'factura'} tam={22} /></span>
                    <div>
                      <b>{d.referencia}</b>
                      <small>{d.tipo_nombre} · enviada {hace(d.fecha)}</small>
                    </div>
                    <div className="sim-acciones">
                      <button type="button" className="sim-btn sim-btn--ok" disabled={enviando !== null} onClick={() => responder(d, 'aceptado')}>
                        <Icono nombre={enviando === d.referencia ? 'recargar' : 'check'} tam={17} className={enviando === d.referencia ? 'sim-giro' : undefined} /> Aceptar
                      </button>
                      <button type="button" className="sim-btn sim-btn--bad" disabled={enviando !== null} onClick={() => setRechazando(d)}>
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
                      {registrado
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

      {rechazando && (
        <ModalRechazo doc={rechazando} enviando={enviando !== null} onCancelar={() => setRechazando(null)} onConfirmar={(motivo) => responder(rechazando, 'rechazado', motivo)} />
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
