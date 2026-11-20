import { useState } from 'react'
import { exportarReporteKpis } from '../../api/kpis.js'
import { descargarBlob } from '../../api/devoluciones.js'
import Modal from '../ui/Modal.jsx'
import Boton from '../ui/Boton.jsx'
import Icono from '../ui/Icono.jsx'
import { Aviso } from '../ui/Aviso.jsx'

const FORMATOS = [
  { id: 'pdf', etiqueta: 'PDF', detalle: 'Para presentar', icono: 'factura' },
  { id: 'xlsx', etiqueta: 'Excel', detalle: 'Una hoja por sección', icono: 'lista' },
]

const SECCIONES = [
  { id: 'resumen', etiqueta: 'Resumen de KPIs' },
  { id: 'cajas', etiqueta: 'Detalle por caja' },
  { id: 'integraciones', etiqueta: 'Integraciones' },
]

/** Primer y ultimo dia de un mes AAAA-MM. */
function rangoMes(periodo) {
  const [a, m] = periodo.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return { desde: `${periodo}-01`, hasta: `${periodo}-${String(ultimo).padStart(2, '0')}` }
}

/**
 * TDSI-209/213/214/215: ventana "⤓ Exportar reporte": Formato (◉ PDF · ○ Excel, PDF por defecto), Periodo (desde – hasta, por
 * defecto el mes elegido en el panel), Incluir (☑ Resumen de KPIs · ☑ Detalle por caja · ☐ Integraciones) y el boton negro
 * "Descargar": muestra la carga, descarga el archivo con el nombre que manda el servidor y avisa claro si falla.
 */
function ModalExportar({ periodo, token, onCerrar, onDescargado }) {
  const inicial = rangoMes(periodo)
  const [formato, setFormato] = useState('pdf')
  const [desde, setDesde] = useState(inicial.desde)
  const [hasta, setHasta] = useState(inicial.hasta)
  const [secciones, setSecciones] = useState(['resumen', 'cajas'])
  const [descargando, setDescargando] = useState(false)
  const [error, setError] = useState(null)

  const sinSecciones = secciones.length === 0
  const rangoInvalido = !desde || !hasta || desde > hasta

  function alternar(id) {
    setSecciones((s) => (s.includes(id) ? s.filter((x) => x !== id) : SECCIONES.map((x) => x.id).filter((x) => s.includes(x) || x === id)))
    setError(null)
  }

  async function descargar() {
    if (sinSecciones || rangoInvalido) return
    setDescargando(true)
    setError(null)
    try {
      const { blob, nombre } = await exportarReporteKpis({ formato, desde, hasta, secciones }, token)
      descargarBlob(blob, nombre)
      onDescargado?.(nombre)
    } catch (err) {
      setError(err.message)
    } finally {
      setDescargando(false)
    }
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      bloqueado={descargando}
      ancho={500}
      titulo="⤓ Exportar reporte"
      subtitulo="Lleve el Panel de KPIs a la reunión de gerencia."
      pie={
        <Boton variante="negro" icono="descargar" cargando={descargando} disabled={sinSecciones || rangoInvalido} onClick={descargar}>
          Descargar
        </Boton>
      }
    >
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="vxp-campo" style={{ marginBottom: 8 }}>Formato</legend>
        <div className="vxp-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }} role="radiogroup" aria-label="Formato">
          {FORMATOS.map((f) => {
            const activo = formato === f.id
            return (
              <label
                key={f.id}
                className="vxp-check"
                style={{
                  padding: '0.75rem 0.85rem',
                  borderRadius: 12,
                  border: `1.5px solid ${activo ? 'var(--vx-navy)' : 'var(--vxp-borde)'}`,
                  background: activo ? '#f3f6fb' : '#fff',
                  transition: 'border-color 160ms ease, background-color 160ms ease',
                }}
              >
                <input type="radio" name="formato" checked={activo} onChange={() => setFormato(f.id)} />
                <Icono nombre={f.icono} tam={18} />
                <span>
                  {f.etiqueta}
                  <span className="vxp-texto-suave" style={{ display: 'block', fontSize: '0.74rem', fontWeight: 500 }}>
                    {f.detalle}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div>
        <span className="vxp-campo" style={{ marginBottom: 8 }}>Periodo</span>
        <div className="vxp-fila" style={{ flexWrap: 'nowrap' }}>
          <label className="vxp-campo" style={{ flex: 1 }}>
            <small>Desde</small>
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <span style={{ marginTop: 18, color: 'var(--vxp-texto-suave)' }}>–</span>
          <label className="vxp-campo" style={{ flex: 1 }}>
            <small>Hasta</small>
            <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
          </label>
        </div>
        {rangoInvalido && <span className="vxp-campo-error">El rango de fechas no es válido.</span>}
      </div>

      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="vxp-campo" style={{ marginBottom: 8 }}>Incluir</legend>
        <div style={{ display: 'grid', gap: 8 }}>
          {SECCIONES.map((s) => (
            <label key={s.id} className="vxp-check">
              <input type="checkbox" checked={secciones.includes(s.id)} onChange={() => alternar(s.id)} />
              {s.etiqueta}
            </label>
          ))}
        </div>
        {sinSecciones && <span className="vxp-campo-error">Marque al menos una sección.</span>}
      </fieldset>

      {error && <Aviso tono="bad" titulo="No se pudo descargar el reporte">{error}</Aviso>}
    </Modal>
  )
}

export default ModalExportar
