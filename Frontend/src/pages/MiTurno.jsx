import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { compararMiCierre, obtenerMiTurno } from '../api/miTurno.js'
import { useAuth } from '../context/AuthContext.jsx'
import Boton from '../components/ui/Boton.jsx'
import Icono from '../components/ui/Icono.jsx'
import { Aviso, Esqueleto, Vacio } from '../components/ui/Aviso.jsx'
import { PuntoSemaforo } from '../components/kpis/TarjetaKPI.jsx'
import { bs, fechaHora, numero } from '../utils/formato.js'

const COLOR_BARRA = {
  VERDE: 'linear-gradient(90deg,#19a874,#12805c)',
  AMARILLO: 'linear-gradient(90deg,#f0c24b,#d69e2e)',
  ROJO: 'linear-gradient(90deg,#f56565,#c53030)',
}
const TONO_CIERRE = { CUADRA: 'ok', SOBRA: 'warn', FALTA: 'bad' }

/** Numero grande con animacion de conteo (solo al cargar; respeta reducir movimiento). */
function Cifra({ valor, formato = (v) => numero(v) }) {
  const [mostrado, setMostrado] = useState(valor)
  const previo = useRef(0)
  useEffect(() => {
    const reducido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reducido || typeof valor !== 'number') {
      setMostrado(valor)
      return undefined
    }
    const desde = previo.current
    const inicio = performance.now()
    let raf
    const paso = (t) => {
      const p = Math.min(1, (t - inicio) / 700)
      const e = 1 - (1 - p) ** 3
      setMostrado(desde + (valor - desde) * e)
      if (p < 1) raf = requestAnimationFrame(paso)
      else previo.current = valor
    }
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
  }, [valor])
  return <>{formato(mostrado)}</>
}

/** TDSI-224: "Mi meta de hoy": "Bs 610 de Bs 1.000 · 61 %" con la barra de avance del color del semaforo. */
function MiMetaDeHoy({ meta }) {
  const pct = meta?.porcentaje
  return (
    <div className={`vxp-card kpi-tarjeta--${meta?.color ?? 'gris'}`} style={{ margin: 0, position: 'relative', overflow: 'hidden' }}>
      <span style={{ position: 'absolute', inset: '0 0 auto', height: 4, background: 'var(--c, var(--kpi-gris))' }} />
      <div className="vxp-fila vxp-fila--entre">
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Mi meta de hoy</h2>
        <PuntoSemaforo color={meta?.color} />
      </div>
      {!meta || meta.meta === null ? (
        <p className="vxp-texto-suave" style={{ margin: '0.9rem 0 0' }}>
          Vendido hoy: <strong style={{ color: 'var(--vx-navy)' }}>{bs(meta?.vendido ?? 0)}</strong>. Tu caja todavía no tiene meta del día.
        </p>
      ) : (
        <>
          <div style={{ margin: '0.8rem 0 0.2rem', fontSize: '1.15rem', fontWeight: 700, color: 'var(--vx-navy)' }}>
            {bs(meta.vendido)} <span className="vxp-texto-suave" style={{ fontWeight: 500 }}>de</span> {bs(meta.meta)} ·{' '}
            <span className={`kpi-texto--${meta.color}`}>{numero(pct, pct % 1 ? 1 : 0)} %</span>
          </div>
          <div style={{ height: 14, borderRadius: 99, background: '#eef1f6', overflow: 'hidden', marginTop: 10 }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, pct))} aria-label="Avance de mi meta de hoy">
            <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', borderRadius: 99, background: COLOR_BARRA[meta.color] ?? '#c5cbd4', transformOrigin: 'left', animation: 'kpi-crece 900ms var(--vxp-ease) 150ms both' }} />
          </div>
          <div className="vxp-texto-suave" style={{ fontSize: '0.8rem', marginTop: 6 }}>
            {pct >= 100 ? '¡Meta cumplida! 🎉' : `Faltan ${bs(meta.meta - meta.vendido)} para llegar a la meta.`}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Lo acumulado en digital (tarjeta + QR) y lo que se devolvio en el turno, con de donde se descontó: del efectivo, del digital o en vale.
 * Son los mismos datos que despues salen en el reporte de cierre.
 */
function DigitalYDevoluciones({ digital, devoluciones }) {
  const dato = (etiqueta, valor, detalle, color) => (
    <div className="vxp-dato" style={{ textAlign: 'center' }}>
      <div className="kpi-tarjeta-valor" style={{ fontSize: '1.35rem', margin: '0.2rem 0', color }}>{bs(valor)}</div>
      <dt style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--vxp-texto-suave)' }}>{etiqueta}</dt>
      {detalle && <div style={{ fontSize: '0.78rem', color: 'var(--vxp-texto-suave)', marginTop: 2 }}>{detalle}</div>}
    </div>
  )
  return (
    <div className="vxp-card" style={{ margin: 0 }}>
      <h2 style={{ margin: '0 0 0.9rem', fontSize: '1.05rem' }}>Digital y devoluciones del turno</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        {dato('Digital acumulado', digital?.cobrado ?? 0, `Tarjeta ${bs(digital?.tarjeta ?? 0)} + QR ${bs(digital?.qr ?? 0)}`)}
        {dato('Devuelto del efectivo', devoluciones?.efectivo ?? 0, 'Se descuenta del efectivo esperado', devoluciones?.efectivo > 0 ? '#b45309' : undefined)}
        {dato('Devuelto del digital', devoluciones?.digital ?? 0, 'Tarjeta o reversión de QR', devoluciones?.digital > 0 ? '#b45309' : undefined)}
        {dato('Digital neto', digital?.neto ?? 0, 'Digital acumulado − devuelto del digital', '#0f7b4f')}
      </div>
      <p style={{ margin: '0.7rem 0 0', fontSize: '0.85rem', color: 'var(--vxp-texto-suave)' }}>
        {devoluciones == null
          ? 'No se pudieron consultar las devoluciones del turno.'
          : `${numero(devoluciones.cantidad)} ${devoluciones.cantidad === 1 ? 'devolución' : 'devoluciones'} en el turno${devoluciones.vale > 0 ? ` · ${bs(devoluciones.vale)} devueltos en vale de compra` : ''}.`}
      </p>
    </div>
  )
}

/** TDSI-224: "Mis números del turno": Ventas, Ticket promedio y Anulaciones. */
function MisNumeros({ numeros }) {
  const items = [
    { etiqueta: 'Ventas', valor: numeros.ventas, formato: (v) => numero(v), icono: 'factura' },
    { etiqueta: 'Ticket promedio', valor: numeros.ticket_promedio, formato: (v) => bs(v), icono: 'dinero' },
    { etiqueta: 'Anulaciones', valor: numeros.anulaciones, formato: (v) => numero(v), icono: 'xCirculo' },
  ]
  return (
    <div className="vxp-card" style={{ margin: 0 }}>
      <h2 style={{ margin: '0 0 0.9rem', fontSize: '1.05rem' }}>Mis números del turno</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {items.map((it) => (
          <div key={it.etiqueta} className="vxp-dato" style={{ textAlign: 'center' }}>
            <Icono nombre={it.icono} tam={18} style={{ color: 'var(--vx-steel)' }} />
            <div className="kpi-tarjeta-valor" style={{ fontSize: '1.45rem', margin: '0.25rem 0' }}>
              <Cifra valor={it.valor} formato={it.formato} />
            </div>
            <dt style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--vxp-texto-suave)' }}>{it.etiqueta}</dt>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * TDSI-225: "Cierre de turno": Efectivo esperado (lo calcula el sistema), Efectivo contado (lo escribe el cajero) y Diferencia con
 * su estado CUADRA ✔ / SOBRA / FALTA, y el boton negro "Cerrar turno" (lleva al cierre de siempre, con el PIN del supervisor).
 */
function CierreDeTurno({ cierre, token, cajaId, onCerrarTurno }) {
  const [contado, setContado] = useState('')
  const [resultado, setResultado] = useState(null)
  const [calculando, setCalculando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (contado.trim() === '') {
      setResultado(null)
      setError(null)
      return undefined
    }
    const n = Number(contado)
    if (!Number.isFinite(n) || n < 0) {
      setError('Escriba un monto válido.')
      return undefined
    }
    setCalculando(true)
    const t = setTimeout(async () => {
      try {
        const r = await compararMiCierre(token, { efectivo_contado: Math.round(n * 100) / 100, caja_id: cajaId })
        setResultado(r.data)
        setError(null)
      } catch (err) {
        setError(err.message)
        setResultado(null)
      } finally {
        setCalculando(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [contado, token, cajaId])

  const fila = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0.75rem 0', borderBottom: '1px solid #eef1f6' }

  return (
    <div className="vxp-card" style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.05rem' }}>Cierre de turno</h2>
      <div style={fila}>
        <span style={{ fontWeight: 600 }}>Efectivo esperado</span>
        <span className="vxp-monto" style={{ fontSize: '1.1rem', color: 'var(--vx-navy)' }}>{bs(cierre.efectivo_esperado)}</span>
      </div>
      <div style={fila}>
        <label htmlFor="efectivo-contado" style={{ fontWeight: 600 }}>
          Efectivo contado
        </label>
        <div className="vxp-stepper" style={{ maxWidth: 190 }}>
          <span style={{ padding: '0 0.55rem', color: 'var(--vxp-texto-suave)', fontWeight: 700, fontSize: '0.82rem' }}>Bs</span>
          <input
            id="efectivo-contado"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={contado}
            onChange={(e) => setContado(e.target.value)}
            placeholder="0,00"
            style={{ width: 120, textAlign: 'right', paddingRight: 10, borderInline: 0 }}
          />
        </div>
      </div>
      <div style={{ ...fila, borderBottom: 0 }}>
        <span style={{ fontWeight: 600 }}>Diferencia</span>
        <span aria-live="polite" style={{ minHeight: 30, display: 'flex', alignItems: 'center' }}>
          {calculando ? (
            <span className="vxp-spinner" style={{ width: 16, height: 16, color: 'var(--vx-steel)' }} />
          ) : resultado ? (
            <span className={`vxp-badge vxp-badge--${TONO_CIERRE[resultado.estado] ?? 'neutro'}`} style={{ fontSize: '0.86rem', padding: '0.35rem 0.75rem' }}>
              {bs(Math.abs(resultado.diferencia))} · {resultado.estado}
              {resultado.estado === 'CUADRA' ? ' ✔' : ''}
            </span>
          ) : (
            <span className="vxp-texto-suave">—</span>
          )}
        </span>
      </div>
      {error && <span className="vxp-campo-error">{error}</span>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 12 }}>
        <Boton variante="negro" icono="candado" onClick={onCerrarTurno}>
          Cerrar turno
        </Boton>
      </div>
    </div>
  )
}

/** TDSI-225: cuadro amarillo "⚠ Avisos" con los consejos cortos. */
function Avisos({ avisos }) {
  return (
    <div className="vxp-card" style={{ margin: 0, background: 'linear-gradient(180deg,#fffaeb,#fdf3dc)', borderColor: '#f3d9a4' }}>
      <h2 style={{ margin: '0 0 0.8rem', fontSize: '1.05rem', color: '#7a5a00' }}>⚠ Avisos</h2>
      <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: 8, color: '#5c4400', fontWeight: 500 }}>
        {avisos.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * TDSI-219/223: pantalla "Mi turno" del cajero (/caja/mi-turno), solo con los datos de SU turno abierto y de SU caja.
 * Arriba "Mi meta de hoy" y "Mis números del turno"; abajo "Cierre de turno" y "⚠ Avisos". Se actualiza cada 60 s.
 */
function MiTurno() {
  const { cajero } = useAuth()
  const navigate = useNavigate()
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    if (!cajero?.access_token) {
      setError('Su sesión no tiene credenciales para ver sus indicadores. Cierre sesión y vuelva a ingresar.')
      setCargando(false)
      return
    }
    try {
      const r = await obtenerMiTurno(cajero.access_token, cajero.caja)
      setDatos(r.data)
      setError(null)
    } catch (err) {
      setError(err.status === 401 ? 'Su sesión expiró. Cierre sesión y vuelva a ingresar para ver sus indicadores.' : err.message)
    } finally {
      setCargando(false)
    }
  }, [cajero])

  useEffect(() => {
    cargar()
    const t = setInterval(() => !document.hidden && cargar(), 60000)
    return () => clearInterval(t)
  }, [cargar])

  return (
    <section>
      <header className="vxp-hero">
        <div className="vxp-hero-titulo">
          <span className="vxp-hero-icono">
            <Icono nombre="objetivo" tam={24} />
          </span>
          <div>
            <h1>Mi turno</h1>
            <p>
              TallerSis · {cajero?.cajaNombre ?? cajero?.caja} · {cajero?.nombre}
              {datos?.turno && ` · abierto ${fechaHora(datos.turno.abierto_en)}`}
            </p>
          </div>
        </div>
        <Boton variante="vidrio" icono="recargar" onClick={cargar}>
          Actualizar
        </Boton>
      </header>

      {cargando && !datos ? (
        <div className="vxp-grid vxp-grid--2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="vxp-card" style={{ margin: 0 }}>
              <Esqueleto filas={3} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="vxp-card">
          <Aviso tono="bad" titulo="No se pudo cargar Mi turno">
            {error}
          </Aviso>
        </div>
      ) : !datos?.turno ? (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="vxp-card" style={{ margin: 0 }}>
            <Vacio icono="candado" titulo={datos?.mensaje ?? 'Abra su turno para ver sus indicadores'} accion={<Boton onClick={() => navigate('/')}>Ir a abrir el turno</Boton>} />
          </div>
          {datos?.avisos && <Avisos avisos={datos.avisos} />}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className="vxp-grid vxp-grid--2 vxp-escalon" style={{ alignItems: 'stretch' }}>
            <MiMetaDeHoy meta={datos.meta_hoy} />
            <MisNumeros numeros={datos.numeros} />
          </div>
          <DigitalYDevoluciones digital={datos.digital} devoluciones={datos.devoluciones} />
          <div className="vxp-grid vxp-grid--2" style={{ alignItems: 'stretch' }}>
            <CierreDeTurno
              cierre={datos.cierre}
              token={cajero.access_token}
              cajaId={cajero.caja}
              // el cierre usa el arqueo que ya existe (billetes y monedas + PIN del supervisor)
              onCerrarTurno={() => navigate('/cierre-caja')}
            />
            <Avisos avisos={datos.avisos ?? []} />
          </div>
        </div>
      )}
    </section>
  )
}

export default MiTurno
