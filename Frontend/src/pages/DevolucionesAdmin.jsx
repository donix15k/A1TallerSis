import { useCallback, useEffect, useState } from 'react'
import { descargarBlob, exportarDevolucionesExcel, listarDevolucionesAdmin } from '../api/devoluciones.js'
import { useAdminAuth } from '../context/AdminAuthContext.jsx'
import Boton from '../components/ui/Boton.jsx'
import Icono from '../components/ui/Icono.jsx'
import Drawer from '../components/ui/Drawer.jsx'
import { Aviso, Esqueleto, Vacio } from '../components/ui/Aviso.jsx'
import { useToast } from '../components/ui/Toasts.jsx'
import LineaTiempoDevolucion from '../components/devoluciones/LineaTiempoDevolucion.jsx'
import CeldaContabilidad from '../components/devoluciones/CeldaContabilidad.jsx'
import { ESTADO_BADGE } from '../components/devoluciones/DetalleDevolucion.jsx'
import { bs, fechaHora } from '../utils/formato.js'

const ESTADOS = [
  { id: '', etiqueta: 'Todos' },
  { id: 'PENDIENTE', etiqueta: 'Pendiente' },
  { id: 'APROBADA', etiqueta: 'Aprobada' },
  { id: 'RECHAZADA', etiqueta: 'Rechazada' },
  { id: 'PROCESADA', etiqueta: 'Procesada' },
]

const FILTROS_INICIALES = { desde: '', hasta: '', estado: '', cajero: '' }

/**
 * TDSI-78/83: vista de control del administrador: todas las devoluciones con filtros por fechas (dia completo),
 * estado y cajero, paginadas de 20 en 20. Al abrir una se ve su linea de tiempo (TDSI-84) y "Exportar a Excel"
 * descarga exactamente lo filtrado (TDSI-85).
 */
function DevolucionesAdmin() {
  const { administrador } = useAdminAuth()
  const token = administrador?.access_token
  const toast = useToast()

  const [borrador, setBorrador] = useState(FILTROS_INICIALES)
  const [filtros, setFiltros] = useState(FILTROS_INICIALES)
  const [pagina, setPagina] = useState(1)
  const [datos, setDatos] = useState({ filas: [], total: 0, total_paginas: 1 })
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [abierta, setAbierta] = useState(null)
  const [exportando, setExportando] = useState(false)

  const cargar = useCallback(async ({ silencioso = false } = {}) => {
    if (!token) return
    if (!silencioso) setCargando(true)
    try {
      const r = await listarDevolucionesAdmin({ ...filtros, pagina }, token)
      setDatos({ filas: r.data, total: r.total, total_paginas: r.total_paginas ?? 1 })
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setCargando(false)
    }
  }, [filtros, pagina, token])

  useEffect(() => {
    cargar()
  }, [cargar])

  // TDSI-96: mientras alguna nota este Pendiente o Enviado en Contabilidad, la tabla se refresca sola cada 10 s
  // para mostrar "Registrado – Asiento N° X" (o el rechazo) apenas responda Contabilidad.
  const hayEnviosEnCurso = datos.filas.some((f) => f.contabilidad && ['Pendiente', 'Enviado'].includes(f.contabilidad.estado))
  useEffect(() => {
    if (!hayEnviosEnCurso) return undefined
    const t = setInterval(() => !document.hidden && cargar({ silencioso: true }), 10000)
    return () => clearInterval(t)
  }, [hayEnviosEnCurso, cargar])

  function aplicar(e) {
    e?.preventDefault()
    if (borrador.desde && borrador.hasta && borrador.desde > borrador.hasta) {
      toast.aviso('Rango de fechas inválido', '"Desde" no puede ser posterior a "Hasta".')
      return
    }
    setPagina(1)
    setFiltros(borrador)
  }

  function limpiar() {
    setBorrador(FILTROS_INICIALES)
    setFiltros(FILTROS_INICIALES)
    setPagina(1)
  }

  async function exportar() {
    setExportando(true)
    try {
      const { blob, nombre, truncado } = await exportarDevolucionesExcel(filtros, token)
      descargarBlob(blob, nombre)
      if (truncado) toast.aviso('Exportación parcial', 'Se exportaron las primeras 10.000 filas.')
      else toast.ok('Excel descargado', nombre)
    } catch (err) {
      toast.error('No se pudo exportar', err.message)
    } finally {
      setExportando(false)
    }
  }

  const filtrosActivos = Object.values(filtros).filter(Boolean).length

  return (
    <section>
      <header className="vxp-hero">
        <div className="vxp-hero-titulo">
          <span className="vxp-hero-icono">
            <Icono nombre="devolucion" tam={24} />
          </span>
          <div>
            <h1>Devoluciones</h1>
            <p>Audite quién pidió cada devolución, quién la autorizó y cuándo se reembolsó.</p>
          </div>
        </div>
        <div className="vxp-hero-acciones">
          <Boton variante="vidrio" icono="descargar" cargando={exportando} onClick={exportar} disabled={datos.total === 0}>
            Exportar a Excel
          </Boton>
        </div>
      </header>

      <form className="vxp-card" onSubmit={aplicar}>
        <div className="vxp-filtros">
          <label className="vxp-campo">
            Desde
            <input type="date" value={borrador.desde} onChange={(e) => setBorrador((b) => ({ ...b, desde: e.target.value }))} />
          </label>
          <label className="vxp-campo">
            Hasta
            <input type="date" value={borrador.hasta} onChange={(e) => setBorrador((b) => ({ ...b, hasta: e.target.value }))} />
          </label>
          <label className="vxp-campo">
            Estado
            <select value={borrador.estado} onChange={(e) => setBorrador((b) => ({ ...b, estado: e.target.value }))}>
              {ESTADOS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.etiqueta}
                </option>
              ))}
            </select>
          </label>
          <label className="vxp-campo">
            Cajero
            <input value={borrador.cajero} placeholder="Correo o parte de él" onChange={(e) => setBorrador((b) => ({ ...b, cajero: e.target.value }))} />
          </label>
          <div className="vxp-fila" style={{ flexWrap: 'nowrap' }}>
            <Boton type="submit" icono="filtro" bloque>
              Filtrar
            </Boton>
            {filtrosActivos > 0 && (
              <Boton variante="fantasma" onClick={limpiar} title="Quitar filtros">
                Limpiar
              </Boton>
            )}
          </div>
        </div>
      </form>

      <div className="vxp-card">
        <h2 className="vxp-card-titulo">
          Historial de devoluciones
          <small>
            {datos.total} {datos.total === 1 ? 'devolución' : 'devoluciones'}
            {filtrosActivos > 0 && ` · ${filtrosActivos} ${filtrosActivos === 1 ? 'filtro' : 'filtros'}`}
          </small>
        </h2>

        {error && <Aviso tono="bad" titulo="No se pudo cargar el historial">{error}</Aviso>}

        {cargando && datos.filas.length === 0 ? (
          <Esqueleto filas={6} alto={24} />
        ) : datos.filas.length === 0 && !error ? (
          <Vacio icono="filtro" titulo="Sin resultados">
            No hay devoluciones con esos filtros.
          </Vacio>
        ) : (
          <>
            <div className="vxp-tabla-envoltura" style={{ opacity: cargando ? 0.6 : 1, transition: 'opacity 160ms ease' }}>
              <table className="vxp-tabla">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Factura</th>
                    <th>Cajero</th>
                    <th>Tipo</th>
                    <th>Motivo</th>
                    <th className="num">Monto</th>
                    <th>Estado</th>
                    <th>Contabilidad</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.filas.map((d) => (
                    <tr
                      key={d.codigo}
                      className={`vxp-fila--clic${abierta?.codigo === d.codigo ? ' vxp-fila--seleccionada' : ''}`}
                      onClick={() => setAbierta(d)}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setAbierta(d)}
                    >
                      <td className="vxp-codigo">{d.codigo}</td>
                      <td className="vxp-codigo" style={{ fontWeight: 600 }}>{d.factura_numero}</td>
                      <td style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis' }} title={d.cajero}>{d.cajero}</td>
                      <td>
                        <span className={`vxp-badge vxp-badge--sin-punto ${d.tipo === 'TOTAL' ? 'vxp-badge--violeta' : 'vxp-badge--neutro'}`}>{d.tipo}</span>
                      </td>
                      <td>{d.motivo?.nombre ?? '—'}</td>
                      <td className="num vxp-monto">{bs(d.monto_total)}</td>
                      <td>
                        <span className={`vxp-badge vxp-badge--${ESTADO_BADGE[d.estado] ?? 'neutro'}`}>{d.estado}</span>
                      </td>
                      <td onClick={(e) => d.contabilidad?.estado === 'Error' && e.stopPropagation()}>
                        <CeldaContabilidad
                          devolucion={d}
                          token={token}
                          onActualizada={(nueva) => setDatos((prev) => ({ ...prev, filas: prev.filas.map((f) => (f.codigo === nueva.codigo ? nueva : f)) }))}
                        />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fechaHora(d.fecha_solicitud)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="vxp-paginacion">
              <span>
                Página {pagina} de {datos.total_paginas}
              </span>
              <div className="vxp-fila">
                <Boton variante="claro" tam="sm" disabled={pagina <= 1 || cargando} onClick={() => setPagina((p) => p - 1)}>
                  Anterior
                </Boton>
                <Boton variante="claro" tam="sm" disabled={pagina >= datos.total_paginas || cargando} onClick={() => setPagina((p) => p + 1)}>
                  Siguiente
                </Boton>
              </div>
            </div>
          </>
        )}
      </div>

      <Drawer
        abierto={Boolean(abierta)}
        onCerrar={() => setAbierta(null)}
        titulo={abierta ? `${abierta.codigo} · ${bs(abierta.monto_total)}` : ''}
        subtitulo={abierta ? `Factura ${abierta.factura_numero} · ${abierta.motivo?.nombre ?? 'Sin motivo'}` : ''}
      >
        {abierta && (
          <div style={{ display: 'grid', gap: '1.1rem' }}>
            <dl className="vxp-datos">
              <div className="vxp-dato">
                <dt>Estado</dt>
                <dd>
                  <span className={`vxp-badge vxp-badge--${ESTADO_BADGE[abierta.estado] ?? 'neutro'}`}>{abierta.estado}</span>
                </dd>
              </div>
              <div className="vxp-dato">
                <dt>Tipo</dt>
                <dd>{abierta.tipo}</dd>
              </div>
            </dl>
            <div>
              <h3 className="vxp-card-titulo" style={{ fontSize: '0.95rem' }}>Línea de tiempo</h3>
              <LineaTiempoDevolucion codigo={abierta.codigo} token={token} />
            </div>
          </div>
        )}
      </Drawer>
    </section>
  )
}

export default DevolucionesAdmin
