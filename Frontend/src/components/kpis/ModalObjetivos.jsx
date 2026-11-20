import { useEffect, useMemo, useState } from 'react'
import { guardarObjetivos, obtenerObjetivos } from '../../api/kpis.js'
import Modal from '../ui/Modal.jsx'
import Boton from '../ui/Boton.jsx'
import { Aviso, Esqueleto } from '../ui/Aviso.jsx'

const NOMBRES_CORTOS = {
  ticket_promedio: 'Ticket promedio',
  tasa_anulacion: 'Anulación',
  tasa_devoluciones: 'Devoluciones',
  cumplimiento_metas: 'Metas por caja',
  efectividad_cuadre: 'Cuadre de caja',
  aceptacion_contable: 'Aceptación contable',
  dias_pago_proveedores: 'Días de pago',
}

const aTexto = (v) => (v === null || v === undefined ? '' : String(v))

/**
 * Valida en el navegador antes de guardar (el servidor vuelve a validar): numeros, porcentajes de 0 a 100, el amarillo entre
 * el verde y el rojo segun el sentido del indicador, y metas mayores a 0. Devuelve { "indicador.campo": mensaje }.
 */
function validar(indicadores, metas) {
  const errores = {}
  for (const i of indicadores) {
    const n = { verde: Number(i.verde), amarillo: Number(i.amarillo), rojo: Number(i.rojo) }
    for (const campo of ['verde', 'amarillo', 'rojo']) {
      const v = i[campo]
      if (String(v).trim() === '' || !Number.isFinite(Number(v))) errores[`${i.indicador}.${campo}`] = 'Escriba un número.'
      else if (Number(v) < 0) errores[`${i.indicador}.${campo}`] = 'No puede ser negativo.'
      else if (i.unidad === '%' && Number(v) > 100) errores[`${i.indicador}.${campo}`] = 'Los porcentajes van de 0 a 100.'
    }
    if (Object.keys(errores).some((k) => k.startsWith(`${i.indicador}.`))) continue
    if (i.sentido === 'MAYOR' ? !(n.rojo <= n.amarillo && n.amarillo <= n.verde) : !(n.verde <= n.amarillo && n.amarillo <= n.rojo)) {
      errores[`${i.indicador}.amarillo`] = 'El amarillo debe quedar entre el verde y el rojo.'
    }
  }
  for (const m of metas) {
    if (String(m.monto_mensual).trim() === '') continue // sin cambios: no se envia
    const v = Number(m.monto_mensual)
    if (!Number.isFinite(v) || v <= 0) errores[`metas.${m.caja_id}`] = 'La meta debe ser mayor a 0.'
  }
  return errores
}

/** Campo numerico de la tabla con su prefijo (≥, ≤, <, >) y el error debajo. */
function CampoLimite({ prefijo, sufijo, valor, onCambiar, error, etiqueta }) {
  return (
    <div>
      <div className={`vxp-stepper${error ? ' vxp-input--error' : ''}`} style={{ width: '100%', borderColor: error ? 'var(--vxp-bad)' : undefined }}>
        <span style={{ padding: '0 0.5rem', color: 'var(--vxp-texto-suave)', fontWeight: 700, fontSize: '0.82rem' }}>{prefijo}</span>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={valor}
          onChange={(e) => onCambiar(e.target.value)}
          aria-label={etiqueta}
          aria-invalid={Boolean(error)}
          style={{ flex: 1, width: '100%', textAlign: 'left', borderInline: 0 }}
        />
        {sufijo && <span style={{ padding: '0 0.55rem', color: 'var(--vxp-texto-suave)', fontSize: '0.8rem' }}>{sufijo}</span>}
      </div>
      {error && <div className="vxp-campo-error" style={{ marginTop: 3 }}>{error}</div>}
    </div>
  )
}

/**
 * TDSI-199/203/204/205: ventana "⚙ Configurar objetivos del semáforo" sobre el panel (fondo oscurecido, ✕ arriba a la derecha):
 * tabla KPI · Verde · Amarillo · Rojo con tres campos por indicador, filas "Meta Caja N" con un campo en Bs, y abajo a la derecha
 * "Cancelar" (blanco) y "Guardar" (negro). Guardar aplica los limites y metas a todo el panel desde ese momento.
 */
function ModalObjetivos({ token, onCerrar, onGuardado }) {
  const [indicadores, setIndicadores] = useState(null)
  const [metas, setMetas] = useState([])
  const [metasError, setMetasError] = useState(null)
  const [error, setError] = useState(null)
  const [errores, setErrores] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [originales, setOriginales] = useState(null)

  useEffect(() => {
    obtenerObjetivos(token)
      .then((r) => {
        const ind = r.data.indicadores.map((i) => ({ ...i, verde: aTexto(i.verde), amarillo: aTexto(i.amarillo), rojo: aTexto(i.rojo) }))
        const m = (r.data.metas_cajas ?? []).map((c) => ({ ...c, monto_mensual: aTexto(c.monto_mensual) }))
        setIndicadores(ind)
        setMetas(m)
        setOriginales({ ind, m })
        setMetasError(r.data.metas_error ?? null)
      })
      .catch((err) => setError(err.message))
  }, [token])

  const cambios = useMemo(() => {
    if (!originales || !indicadores) return { indicadores: [], metas: [] }
    const ind = indicadores.filter((i, k) => ['verde', 'amarillo', 'rojo'].some((c) => i[c] !== originales.ind[k][c]))
    const m = metas.filter((x, k) => x.monto_mensual !== originales.m[k].monto_mensual && x.monto_mensual.trim() !== '')
    return { indicadores: ind, metas: m }
  }, [indicadores, metas, originales])

  function cambiarLimite(indicador, campo, valor) {
    setIndicadores((lista) => lista.map((i) => (i.indicador === indicador ? { ...i, [campo]: valor } : i)))
    setErrores((e) => {
      const { [`${indicador}.${campo}`]: _quitar, [`${indicador}.amarillo`]: _amarillo, ...resto } = e
      return resto
    })
  }

  async function guardar() {
    const locales = validar(indicadores, metas)
    setErrores(locales)
    if (Object.keys(locales).length) return
    if (!cambios.indicadores.length && !cambios.metas.length) {
      onCerrar()
      return
    }
    setGuardando(true)
    setError(null)
    try {
      await guardarObjetivos(
        {
          ...(cambios.indicadores.length && {
            indicadores: cambios.indicadores.map((i) => ({ indicador: i.indicador, verde: Number(i.verde), amarillo: Number(i.amarillo), rojo: Number(i.rojo) })),
          }),
          ...(cambios.metas.length && { metas_cajas: cambios.metas.map((m) => ({ caja_id: m.caja_id, monto_mensual: Number(m.monto_mensual) })) }),
        },
        token,
      )
      onGuardado?.()
    } catch (err) {
      const lista = err.detalle?.errores ?? []
      if (lista.length) {
        const porCampo = {}
        for (const e of lista) porCampo[e.campo.replace(/^metas_cajas\./, 'metas.')] = e.mensaje
        setErrores(porCampo)
      }
      setError(err.message)
      setGuardando(false)
    }
  }

  const prefijos = (i) => (i.sentido === 'MAYOR' ? ['≥', '≥', '<'] : ['≤', '≤', '>'])
  const hayErrores = Object.keys(errores).length > 0

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      bloqueado={guardando}
      ancho={760}
      titulo="⚙ Configurar objetivos del semáforo"
      subtitulo="Los nuevos límites y metas se aplican a todo el panel desde que se guardan."
      pie={
        <>
          <Boton variante="claro" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton variante="negro" icono="check" cargando={guardando} disabled={!indicadores || hayErrores} onClick={guardar}>
            Guardar
          </Boton>
        </>
      }
    >
      {!indicadores && !error && <Esqueleto filas={7} alto={34} />}
      {error && <Aviso tono="bad" titulo="No se pudo guardar">{error}</Aviso>}

      {indicadores && (
        <div className="vxp-tabla-envoltura">
          <table className="vxp-tabla" style={{ fontSize: '0.86rem' }}>
            <thead>
              <tr>
                <th>KPI</th>
                <th style={{ color: 'var(--kpi-verde)' }}>● Verde</th>
                <th style={{ color: '#a6741b' }}>● Amarillo</th>
                <th style={{ color: 'var(--kpi-rojo)' }}>● Rojo</th>
              </tr>
            </thead>
            <tbody>
              {indicadores.map((i) => {
                const [pv, pa, pr] = prefijos(i)
                const unidad = i.unidad === 'Bs' ? 'Bs' : i.unidad
                return (
                  <tr key={i.indicador}>
                    <td style={{ fontWeight: 650, minWidth: 140 }}>
                      {NOMBRES_CORTOS[i.indicador] ?? i.nombre}
                      <div className="vxp-texto-suave" style={{ fontSize: '0.7rem', fontWeight: 500 }}>
                        {i.sentido === 'MAYOR' ? 'Más es mejor' : 'Menos es mejor'}
                      </div>
                    </td>
                    <td>
                      <CampoLimite prefijo={pv} sufijo={unidad} valor={i.verde} etiqueta={`${i.nombre}: verde`} error={errores[`${i.indicador}.verde`]} onCambiar={(v) => cambiarLimite(i.indicador, 'verde', v)} />
                    </td>
                    <td>
                      <CampoLimite prefijo={pa} sufijo={unidad} valor={i.amarillo} etiqueta={`${i.nombre}: amarillo`} error={errores[`${i.indicador}.amarillo`]} onCambiar={(v) => cambiarLimite(i.indicador, 'amarillo', v)} />
                    </td>
                    <td>
                      <CampoLimite prefijo={pr} sufijo={unidad} valor={i.rojo} etiqueta={`${i.nombre}: rojo`} error={errores[`${i.indicador}.rojo`]} onCambiar={(v) => cambiarLimite(i.indicador, 'rojo', v)} />
                    </td>
                  </tr>
                )
              })}
              {metas.map((m, k) => (
                <tr key={m.caja_id} style={k === 0 ? { borderTop: '2px solid var(--vxp-borde)' } : undefined}>
                  <td style={{ fontWeight: 650 }}>
                    Meta {m.caja_nombre ?? m.caja_id}
                    <div className="vxp-texto-suave" style={{ fontSize: '0.7rem', fontWeight: 500 }}>Mensual</div>
                  </td>
                  <td colSpan={3}>
                    <div style={{ maxWidth: 260 }}>
                      <CampoLimite
                        prefijo="Bs"
                        valor={m.monto_mensual}
                        etiqueta={`Meta mensual de ${m.caja_nombre ?? m.caja_id}`}
                        error={errores[`metas.${m.caja_id}`]}
                        onCambiar={(v) => {
                          setMetas((lista) => lista.map((x) => (x.caja_id === m.caja_id ? { ...x, monto_mensual: v } : x)))
                          setErrores(({ [`metas.${m.caja_id}`]: _q, ...resto }) => resto)
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {metasError && <Aviso tono="warn" titulo="No se pudieron leer las metas de las cajas">{metasError}</Aviso>}
      {(cambios.indicadores.length > 0 || cambios.metas.length > 0) && (
        <span className="vxp-texto-suave" style={{ fontSize: '0.8rem' }}>
          {cambios.indicadores.length + cambios.metas.length} {cambios.indicadores.length + cambios.metas.length === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}
        </span>
      )}
    </Modal>
  )
}

export default ModalObjetivos
