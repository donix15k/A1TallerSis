import { useState } from 'react'
import { listarMensajesIntegracion, reenviarMensajeIntegracion } from '../../api/integraciones.js'
import Boton from '../ui/Boton.jsx'
import Icono from '../ui/Icono.jsx'
import { Aviso, Esqueleto, Vacio } from '../ui/Aviso.jsx'
import { useToast } from '../ui/Toasts.jsx'
import { PuntoSemaforo } from './TarjetaKPI.jsx'
import { bs, hace, numero } from '../../utils/formato.js'

/** Tarjeta de estado con el punto del semaforo arriba a la derecha. */
function TarjetaEstado({ titulo, icono, color, lineas, cargando }) {
  return (
    <div className={`vxp-card kpi-tarjeta--${color ?? 'gris'}`} style={{ margin: 0, position: 'relative', overflow: 'hidden' }}>
      <span style={{ position: 'absolute', inset: '0 0 auto', height: 4, background: 'var(--c, var(--kpi-gris))' }} />
      <div className="vxp-fila vxp-fila--entre" style={{ marginBottom: 10 }}>
        <strong style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', color: 'var(--vx-navy)' }}>
          <Icono nombre={icono} tam={18} /> {titulo}
        </strong>
        <PuntoSemaforo color={color} />
      </div>
      {cargando ? (
        <Esqueleto filas={2} />
      ) : (
        lineas.map((l, i) => (
          <div key={i} style={i === 0 ? { fontSize: '1.15rem', fontWeight: 750, color: 'var(--vx-navy)' } : { fontSize: '0.86rem', color: 'var(--vxp-texto-suave)', marginTop: 4 }}>
            {l}
          </div>
        ))
      )}
    </div>
  )
}

/**
 * TDSI-183: fila de 3 tarjetas: Contabilidad (Aceptación %, X de Y asientos), Compras / Proveedores (órdenes recibidas, último
 * mensaje) y Marketplace (pedidos sincronizados, mensajes en reintento). Contabilidad usa el semaforo del KPI 6; Compras y
 * Marketplace: VERDE sin errores ni reintentos, AMARILLO con reintentos, ROJO con errores.
 */
function TarjetasEstado({ tarjetas, cargando }) {
  const c = tarjetas?.contabilidad
  const p = tarjetas?.compras
  const m = tarjetas?.marketplace
  return (
    <div className="vxp-grid vxp-grid--3 vxp-escalon">
      <TarjetaEstado
        titulo="Contabilidad"
        icono="libro"
        cargando={cargando && !tarjetas}
        color={c?.color}
        lineas={
          !c?.disponible
            ? ['—', c?.error ?? 'Sin datos']
            : c.sin_asientos
              ? ['Sin asientos', 'No se enviaron asientos en el periodo']
              : [`Aceptación ${numero(c.porcentaje, 1)} %`, `${numero(c.registrados)} de ${numero(c.enviados)} asientos`]
        }
      />
      <TarjetaEstado
        titulo="Compras / Proveedores"
        icono="camion"
        cargando={cargando && !tarjetas}
        color={p?.color}
        lineas={
          !p
            ? ['—']
            : [
                `${p.ordenes_recibidas ?? '—'} órdenes recibidas`,
                `Último mensaje: ${p.ultimo_mensaje_en ? hace(p.ultimo_mensaje_en) : 'sin mensajes'}`,
                ...(p.mensajes_en_error ? [`${p.mensajes_en_error} con error`] : []),
              ]
        }
      />
      <TarjetaEstado
        titulo="Marketplace"
        icono="globo"
        cargando={cargando && !tarjetas}
        color={m?.color}
        lineas={!m ? ['—'] : [`${numero(m.pedidos_sincronizados)} pedidos sincronizados`, `${numero(m.mensajes_en_reintento)} mensajes en reintento`, ...(m.mensajes_en_error ? [`${m.mensajes_en_error} con error`] : [])]}
      />
    </div>
  )
}

/**
 * TDSI-184: "Asientos rechazados (N)" con cada asiento y su motivo, y el boton negro "⟳ Reenviar" abajo a la derecha. Usa el
 * reenvio del Monitor de integraciones (TDSI-125): ubica cada asiento rechazado (y los envios en Error a Contabilidad) entre los
 * mensajes del monitor y los reenvia con su misma idempotency_key. Informa cuantos se reenviaron y cuales el dueño no acepto.
 */
function AsientosRechazados({ aceptacion, token, onReenviados }) {
  const [enviando, setEnviando] = useState(false)
  const toast = useToast()

  async function reenviar() {
    setEnviando(true)
    try {
      const r = await listarMensajesIntegracion({ grupo: 'D', por_pagina: 100 }, token)
      const referencias = new Set(aceptacion.rechazados_lista.map((a) => a.referencia))
      const candidatos = r.data.filter((msj) => msj.estado === 'Error' || referencias.has(msj.referencia))
      if (candidatos.length === 0) {
        toast.info('Nada para reenviar', 'No se encontraron los asientos rechazados entre los mensajes del monitor.')
        return
      }
      const resultados = await Promise.allSettled(candidatos.map((msj) => reenviarMensajeIntegracion(msj, token)))
      const ok = resultados.filter((x) => x.status === 'fulfilled' && x.value.data?.estado !== 'Error').length
      const fallidos = resultados.map((x, i) => ({ x, msj: candidatos[i] })).filter(({ x }) => x.status === 'rejected' || x.value.data?.estado === 'Error')
      if (ok > 0) toast.ok(`${ok} ${ok === 1 ? 'asiento reenviado' : 'asientos reenviados'} a Contabilidad`)
      if (fallidos.length > 0) {
        toast.aviso(
          `${fallidos.length} no se pudieron reenviar`,
          fallidos
            .slice(0, 3)
            .map(({ x, msj }) => `${msj.referencia}: ${x.status === 'rejected' ? x.reason?.message : x.value.data?.error ?? 'volvió a fallar'}`)
            .join(' · '),
        )
      }
      onReenviados?.()
    } catch (err) {
      toast.error('No se pudo reenviar', err.message)
    } finally {
      setEnviando(false)
    }
  }

  const lista = aceptacion?.rechazados_lista ?? []
  return (
    <div className="vxp-card" style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
      <h3 className="vxp-card-titulo">Asientos rechazados ({numero(aceptacion?.rechazados_total ?? 0)})</h3>
      {lista.length === 0 ? (
        <Vacio icono="checkCirculo" titulo="Sin rechazos">Contabilidad no rechazó asientos en el periodo.</Vacio>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
          {lista.map((a) => (
            <li key={`${a.tipo}-${a.id}`} className="vxp-dato" style={{ padding: '0.55rem 0.75rem', display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span className="vxp-codigo" style={{ color: 'var(--kpi-rojo)', whiteSpace: 'nowrap' }}>
                {/^F-/.test(a.referencia) ? `FAC-${a.referencia.replace(/^F-0*/, '')}` : a.referencia}
              </span>
              <span style={{ color: 'var(--vxp-texto-suave)', fontSize: '0.86rem' }}>· {a.motivo}</span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 12 }}>
        <Boton variante="negro" icono="recargar" cargando={enviando} onClick={reenviar} disabled={lista.length === 0}>
          Reenviar
        </Boton>
      </div>
    </div>
  )
}

/**
 * TDSI-185: "Pago a proveedores: X días · ESTADO" y "Órdenes vencidas: N"; las vencidas en un recuadro rojo y debajo las pagadas.
 */
function PagoProveedores({ dias }) {
  if (!dias) return <Esqueleto filas={5} />
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: '1.15rem', fontWeight: 750, color: 'var(--vx-navy)' }}>
        Pago a proveedores: {dias.valor === null ? '—' : `${numero(dias.valor, 1)} días`}{' '}
        <span className={dias.color ? `kpi-texto--${dias.color}` : undefined}>· {dias.color ?? 'SIN DATOS'}</span>
      </div>
      <div style={{ fontWeight: 650, color: dias.ordenes_vencidas_total ? 'var(--kpi-rojo)' : 'var(--vxp-texto-suave)' }}>Órdenes vencidas: {numero(dias.ordenes_vencidas_total)}</div>
      {dias.ordenes_vencidas.length > 0 && (
        <div style={{ display: 'grid', gap: 6, padding: '0.7rem 0.8rem', borderRadius: 12, border: '1.5px solid var(--kpi-rojo)', background: 'var(--vxp-bad-bg)' }}>
          {dias.ordenes_vencidas.map((o) => (
            <div key={o.orden} style={{ fontSize: '0.86rem', color: '#7b1d1d', fontWeight: 600 }}>
              ⚠ {o.orden} · {o.proveedor} · {Math.floor(o.dias)} días · {bs(o.monto)} · <strong>VENCIDA</strong>
            </div>
          ))}
        </div>
      )}
      {dias.ordenes_pagadas.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {dias.ordenes_pagadas.map((o) => (
            <div key={o.orden} style={{ fontSize: '0.84rem', color: 'var(--vxp-texto-suave)' }}>
              {o.orden} · {o.proveedor} · {numero(o.dias, o.dias % 1 ? 1 : 0)} días · <span style={{ color: 'var(--kpi-verde)', fontWeight: 700 }}>PAGADA</span>
            </div>
          ))}
        </div>
      )}
      {dias.sin_ordenes_pagadas && dias.ordenes_vencidas.length === 0 && <span className="vxp-texto-suave">No hubo órdenes pagadas en el periodo.</span>}
    </div>
  )
}

/** TDSI-178: pestaña "Integraciones y proveedores". */
function PestanaIntegraciones({ tarjetas, aceptacion, dias, cargando, token, onRecargar }) {
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <TarjetasEstado tarjetas={tarjetas} cargando={cargando} />
      <div className="vxp-grid vxp-grid--2" style={{ alignItems: 'stretch' }}>
        {cargando && !aceptacion ? (
          <div className="vxp-card" style={{ margin: 0 }}>
            <Esqueleto filas={5} />
          </div>
        ) : aceptacion ? (
          <AsientosRechazados aceptacion={aceptacion} token={token} onReenviados={onRecargar} />
        ) : (
          <Aviso tono="warn" titulo="No se pudo cargar la aceptación contable" />
        )}
        <div className="vxp-card" style={{ margin: 0 }}>
          <h3 className="vxp-card-titulo">Pago a proveedores</h3>
          {cargando && !dias ? <Esqueleto filas={5} /> : dias ? <PagoProveedores dias={dias} /> : <Aviso tono="warn" titulo="No se pudo cargar el pago a proveedores" />}
        </div>
      </div>
    </div>
  )
}

export default PestanaIntegraciones
