import { useCallback, useEffect, useMemo, useState } from 'react'
import { obtenerAnulacionesPorCajero, obtenerCumplimientoMetas, obtenerResumenKpis, obtenerRiesgo, obtenerVentasVsMeta } from '../api/kpis.js'
import PestanaRiesgo from '../components/kpis/PestanaRiesgo.jsx'
import PestanaCajas from '../components/kpis/PestanaCajas.jsx'
import { useAdminAuth } from '../context/AdminAuthContext.jsx'
import Icono from '../components/ui/Icono.jsx'
import { Aviso, Esqueleto } from '../components/ui/Aviso.jsx'
import TarjetaKPI from '../components/kpis/TarjetaKPI.jsx'
import GraficoVentasMeta from '../components/kpis/GraficoVentasMeta.jsx'
import { bs, mesActualBolivia, nombrePeriodo, numero, porcentaje } from '../utils/formato.js'

export const PESTANAS = [
  { id: 'resumen', etiqueta: 'Resumen', icono: 'grafico' },
  { id: 'riesgo', etiqueta: 'Riesgo', icono: 'alerta' },
  { id: 'cajas', etiqueta: 'Cajas', icono: 'caja' },
  { id: 'integraciones', etiqueta: 'Integraciones y proveedores', icono: 'rayo' },
]

/** Los ultimos 12 meses (el actual primero) para el selector de periodo. */
function ultimosMeses(n = 12) {
  const [a, m] = mesActualBolivia().split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const fechaMes = new Date(Date.UTC(a, m - 1 - i, 1))
    return `${fechaMes.getUTCFullYear()}-${String(fechaMes.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

/** Selector de periodo por mes ("Noviembre 2026 ▾"). */
function SelectorPeriodo({ valor, onCambiar }) {
  return (
    <label className="kpi-periodo">
      <Icono nombre="calendario" tam={16} />
      <select value={valor} onChange={(e) => onCambiar(e.target.value)} aria-label="Periodo">
        {ultimosMeses().map((p) => (
          <option key={p} value={p}>
            {nombrePeriodo(p)}
          </option>
        ))}
      </select>
      <Icono nombre="flechaAbajo" tam={16} />
    </label>
  )
}

/**
 * Las 7 tarjetas del Resumen, en el orden del mockup. Cada una lee su dato del estado `datos` y abre su pestaña al hacer clic.
 * Las que todavia no tienen fuente se muestran en gris ("Sin datos").
 */
const TARJETAS = [
  {
    id: 'ticket_promedio',
    nombre: 'Ticket promedio',
    pestana: 'riesgo',
    leer: ({ resumen }) => {
      const t = resumen?.tarjetas?.find((x) => x.id === 'ticket_promedio')
      if (!t) return null
      return { valor: bs(t.valor), color: t.color, detalle: t.detalle?.sin_ventas ? 'Sin ventas en el mes' : `${numero(t.detalle?.ventas_validas)} ventas válidas` }
    },
  },
  {
    // TDSI-152: tarjeta "Anulación" en el Resumen
    id: 'anulacion',
    nombre: 'Anulación',
    pestana: 'riesgo',
    leer: ({ resumen }) => {
      const t = resumen?.tarjetas?.find((x) => x.id === 'anulacion')
      return t ? { valor: porcentaje(t.valor), color: t.color, detalle: `${numero(t.detalle?.anuladas)} de ${numero(t.detalle?.emitidas)} facturas` } : null
    },
  },
  {
    // TDSI-152: tarjeta "Devoluciones" en el Resumen
    id: 'devoluciones',
    nombre: 'Devoluciones',
    pestana: 'riesgo',
    leer: ({ resumen }) => {
      const t = resumen?.tarjetas?.find((x) => x.id === 'devoluciones')
      if (!t) return null
      if (t.detalle?.disponible === false) return { valor: '—', color: null, detalle: 'Devoluciones no respondió' }
      return { valor: porcentaje(t.valor), color: t.color, detalle: `${bs(t.detalle?.monto_devuelto)} devueltos` }
    },
  },
  {
    // TDSI-164: "Metas por caja" con el % general; clic abre la pestaña Cajas
    id: 'metas',
    nombre: 'Metas por caja',
    pestana: 'cajas',
    leer: ({ metas }) => {
      if (!metas) return null
      const g = metas.general
      if (g.porcentaje === null) return { valor: '—', color: null, detalle: 'Sin metas configuradas' }
      return { valor: `${numero(g.porcentaje, g.porcentaje % 1 ? 1 : 0)} %`, color: g.color, detalle: `${bs(g.vendido)} de ${bs(g.meta)}` }
    },
  },
  { id: 'cuadre', nombre: 'Cuadre de caja', pestana: 'cajas', leer: () => null },
  { id: 'aceptacion', nombre: 'Aceptación contable', pestana: 'integraciones', leer: () => null },
  { id: 'pago_proveedores', nombre: 'Pago a proveedores', pestana: 'integraciones', leer: () => null },
]

/**
 * TDSI-136/141: "Panel de KPIs" del administrador (/admin/panel-kpis): 4 pestañas (Resumen se abre por defecto y la activa va en
 * mostaza), selector de periodo a la derecha, fila de 7 tarjetas KPI y el grafico "Ventas diarias vs meta". Al cambiar el periodo
 * se recalcula todo.
 */
function PanelKpis() {
  const { administrador } = useAdminAuth()
  const token = administrador?.access_token
  const [pestana, setPestana] = useState('resumen')
  const [periodo, setPeriodo] = useState(mesActualBolivia)
  const [datos, setDatos] = useState({})
  const [cargando, setCargando] = useState(true)
  const [errores, setErrores] = useState([])

  const cargar = useCallback(async () => {
    if (!token) return
    setCargando(true)
    const fuentes = {
      resumen: () => obtenerResumenKpis(periodo, token),
      ventas: () => obtenerVentasVsMeta(periodo, token),
      riesgo: () => obtenerRiesgo(periodo, token),
      porCajero: () => obtenerAnulacionesPorCajero(periodo, token),
      metas: () => obtenerCumplimientoMetas(periodo, token),
    }
    const claves = Object.keys(fuentes)
    const resultados = await Promise.allSettled(claves.map((k) => fuentes[k]()))
    const nuevos = {}
    const fallas = []
    resultados.forEach((r, i) => {
      if (r.status === 'fulfilled') nuevos[claves[i]] = r.value.data
      else fallas.push({ fuente: claves[i], mensaje: r.reason?.message })
    })
    setDatos(nuevos)
    setErrores(fallas)
    setCargando(false)
  }, [periodo, token])

  useEffect(() => {
    cargar()
  }, [cargar])

  const tarjetas = useMemo(() => TARJETAS.map((t) => ({ ...t, ...(t.leer(datos) ?? {}) })), [datos])

  return (
    <section>
      <header className="vxp-hero" style={{ marginBottom: '1rem' }}>
        <div className="vxp-hero-titulo">
          <span className="vxp-hero-icono">
            <Icono nombre="grafico" tam={24} />
          </span>
          <div>
            <h1>Panel de KPIs</h1>
            <p>El rendimiento del negocio de un vistazo · {nombrePeriodo(periodo)}</p>
          </div>
        </div>
      </header>

      <div className="kpi-barra">
        <div className="kpi-tabs" role="tablist" aria-label="Pestañas del Panel de KPIs">
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={pestana === p.id}
              className={`kpi-tab${pestana === p.id ? ' kpi-tab--activa' : ''}`}
              onClick={() => setPestana(p.id)}
            >
              <Icono nombre={p.icono} tam={16} />
              {p.etiqueta}
            </button>
          ))}
        </div>
        <div className="kpi-acciones">
          <SelectorPeriodo valor={periodo} onCambiar={setPeriodo} />
        </div>
      </div>

      {errores.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <Aviso tono="warn" titulo="Algunos indicadores no se pudieron cargar">
            {errores.map((e) => e.mensaje).filter(Boolean).join(' · ')}
          </Aviso>
        </div>
      )}

      {pestana === 'resumen' && (
        <div role="tabpanel" aria-label="Resumen">
          <div className="kpi-tarjetas vxp-escalon">
            {tarjetas.map((t) => (
              <TarjetaKPI key={t.id} nombre={t.nombre} valor={t.valor} color={t.color} detalle={t.detalle} cargando={cargando} onClick={() => setPestana(t.pestana)} />
            ))}
          </div>

          <div className="kpi-resumen-grid">
            <div className="vxp-card" style={{ margin: 0 }}>
              <h2 className="vxp-card-titulo">
                Ventas diarias vs meta (últimos 30 días)
                {datos.ventas && (
                  <small>
                    {bs(datos.ventas.total_vendido)} vendidos
                    {datos.ventas.dias_sobre_meta !== null && ` · ${datos.ventas.dias_sobre_meta} de ${datos.ventas.dias} días sobre la meta`}
                  </small>
                )}
              </h2>
              {cargando ? <Esqueleto filas={6} alto={30} /> : datos.ventas ? <GraficoVentasMeta key={periodo} serie={datos.ventas.serie} metaDiaria={datos.ventas.meta_diaria} /> : <Aviso tono="warn" titulo="Sin datos del gráfico" />}
            </div>
          </div>
        </div>
      )}

      {pestana === 'riesgo' && (
        <div role="tabpanel" aria-label="Riesgo">
          <PestanaRiesgo riesgo={datos.riesgo} porCajero={datos.porCajero} cargando={cargando} />
        </div>
      )}

      {pestana === 'cajas' && (
        <div role="tabpanel" aria-label="Cajas">
          <PestanaCajas metas={datos.metas} cargando={cargando} />
        </div>
      )}

      {pestana === 'integraciones' && (
        <div className="vxp-card" role="tabpanel">
          <Aviso tono="info" titulo={PESTANAS.find((p) => p.id === pestana)?.etiqueta}>
            Esta pestaña muestra sus indicadores del periodo {nombrePeriodo(periodo)}.
          </Aviso>
        </div>
      )}
    </section>
  )
}

export default PanelKpis
