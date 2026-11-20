import { useCallback, useEffect, useState } from 'react'
import { obtenerAvisosDevolucion } from '../../api/devoluciones.js'
import Boton from '../ui/Boton.jsx'
import Icono from '../ui/Icono.jsx'
import { Esqueleto } from '../ui/Aviso.jsx'
import { fechaHora, hace } from '../../utils/formato.js'

const TONO_COMPRAS = { Pendiente: 'neutro', Enviado: 'info', Recibido: 'ok', 'Reclamo registrado': 'violeta', Error: 'bad' }
const TONO_MARKETPLACE = { Pendiente: 'neutro', Enviado: 'ok', Error: 'bad' }

function Paso({ activo, hecho, error, etiqueta }) {
  const color = error ? 'var(--vxp-bad)' : hecho ? 'var(--vxp-ok)' : activo ? 'var(--vx-steel)' : '#c5cbd4'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color, fontSize: '0.78rem', fontWeight: 700 }}>
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 20,
          height: 20,
          borderRadius: '50%',
          border: `2px solid ${color}`,
          background: hecho || error ? color : '#fff',
          color: '#fff',
        }}
      >
        {hecho && <Icono nombre="check" tam={12} trazo={3} />}
        {error && <Icono nombre="x" tam={12} trazo={3} />}
      </span>
      {etiqueta}
    </div>
  )
}

/**
 * TDSI-108: seccion "Compras" del detalle (estado del aviso de productos devueltos: Enviado, Recibido o Error, y el
 * N° de reclamo cuando Compras reclama al proveedor). TDSI-121: estado del aviso al Marketplace (Enviado o Error)
 * cuando la devolucion vino de un pedido online. Se refresca sola mientras el aviso siga en camino.
 */
function SeccionAvisos({ devolucion, mostrarMarketplace = false, ocultarCompras = false }) {
  const [avisos, setAvisos] = useState(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(() => {
    obtenerAvisosDevolucion(devolucion.codigo)
      .then((r) => setAvisos(r.data))
      .catch(() => setAvisos({ compras: null, marketplace: null, error: true }))
      .finally(() => setCargando(false))
  }, [devolucion.codigo])

  useEffect(() => {
    cargar()
  }, [cargar])

  const enCamino = avisos?.compras && ['Pendiente', 'Enviado'].includes(avisos.compras.estado)
  useEffect(() => {
    if (!enCamino) return undefined
    const t = setInterval(() => !document.hidden && cargar(), 15000)
    return () => clearInterval(t)
  }, [enCamino, cargar])

  const c = avisos?.compras
  const m = avisos?.marketplace
  const esMarketplace = mostrarMarketplace && devolucion.origen === 'MARKETPLACE'
  const textoCompras = c ? (c.estado === 'Reclamo registrado' ? `Reclamo registrado N° ${c.numero_reclamo ?? '—'}` : c.estado === 'Recibido' ? 'Recibido por Compras' : c.estado) : null

  return (
    <div style={{ marginTop: '1.1rem' }}>
      <hr className="vxp-separador" />
      <div className="vxp-grid vxp-grid--2">
        {!ocultarCompras && (
        <div className="vxp-dato" style={{ padding: '0.95rem 1rem' }}>
          <div className="vxp-fila vxp-fila--entre" style={{ marginBottom: 10 }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--vx-navy)' }}>
              <Icono nombre="camion" tam={18} /> Compras
            </strong>
            <Boton variante="fantasma" tam="sm" icono="recargar" onClick={cargar} aria-label="Actualizar avisos" />
          </div>
          {cargando ? (
            <Esqueleto filas={2} />
          ) : c ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <span className={`vxp-badge vxp-badge--${TONO_COMPRAS[c.estado] ?? 'neutro'}${c.estado === 'Enviado' ? ' vxp-badge--vivo' : ''}`} style={{ justifySelf: 'start', ...(c.estado === 'Enviado' ? { '--i-c': 'var(--vx-steel)', '--i-bg': 'var(--vxp-info-bg)' } : {}) }}>
                Compras: {textoCompras}
              </span>
              <div className="vxp-fila" style={{ gap: 14 }}>
                <Paso hecho={c.estado !== 'Pendiente' && c.estado !== 'Error'} error={c.estado === 'Error'} activo etiqueta="Enviado" />
                <Paso hecho={c.estado === 'Recibido' || c.estado === 'Reclamo registrado'} activo={c.estado === 'Enviado'} etiqueta="Recibido" />
                {(c.estado === 'Reclamo registrado' || devolucion.items.some((i) => i.estado_producto === 'DEFECTUOSO')) && (
                  <Paso hecho={c.estado === 'Reclamo registrado'} etiqueta="Reclamo al proveedor" />
                )}
              </div>
              <span className="vxp-texto-suave" style={{ fontSize: '0.78rem' }}>
                {c.acuse_en ? `Confirmado ${hace(c.acuse_en)} (${fechaHora(c.acuse_en)})` : c.enviado_en ? `Enviado ${hace(c.enviado_en)}` : c.ultimo_error ?? 'Se enviará en breve'}
              </span>
            </div>
          ) : (
            <span className="vxp-texto-suave" style={{ fontSize: '0.84rem' }}>
              {avisos?.error ? 'No se pudo consultar el aviso.' : 'Todavía no se avisó a Compras (se avisa al reembolsar).'}
            </span>
          )}
        </div>
        )}

        {esMarketplace && (
          <div className="vxp-dato" style={{ padding: '0.95rem 1rem' }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--vx-navy)', marginBottom: 10 }}>
              <Icono nombre="globo" tam={18} /> Marketplace {devolucion.orden_id ? `· orden ${devolucion.orden_id}` : ''}
            </strong>
            {cargando ? (
              <Esqueleto filas={2} />
            ) : m ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <span className={`vxp-badge vxp-badge--${TONO_MARKETPLACE[m.estado] ?? 'neutro'}`} style={{ justifySelf: 'start' }}>
                  Aviso {m.estado}
                  {m.resultado ? ` · ${String(m.resultado).toLowerCase()}` : ''}
                </span>
                <span className="vxp-texto-suave" style={{ fontSize: '0.78rem' }}>
                  {m.estado === 'Error' ? m.ultimo_error ?? 'El aviso falló; se reintentará solo.' : m.enviado_en ? `Enviado ${hace(m.enviado_en)}` : 'Se enviará en breve'}
                </span>
              </div>
            ) : (
              <span className="vxp-texto-suave" style={{ fontSize: '0.84rem' }}>Se avisa al Marketplace al aprobar y reembolsar o al rechazar.</span>
            )}
            <span className="vxp-badge vxp-badge--neutro vxp-badge--sin-punto" style={{ marginTop: 10 }}>
              Sin reembolso en efectivo: se revierte el pago online
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default SeccionAvisos
