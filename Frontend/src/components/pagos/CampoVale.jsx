import { useState } from 'react'
import { consultarVale } from '../../api/devoluciones.js'
import Boton from '../ui/Boton.jsx'
import Icono from '../ui/Icono.jsx'
import { Aviso } from '../ui/Aviso.jsx'
import { bs, fecha } from '../../utils/formato.js'

const FORMATO_VALE = /^VAL-[A-Z0-9]{6}$/

/** "val4f8k2a" -> "VAL-4F8K2A" */
export function normalizarCodigoVale(valor) {
  const limpio = String(valor ?? '').trim().toUpperCase().replace(/\s+/g, '')
  const resto = limpio.replace(/^VAL-?/, '')
  return /^[A-Z0-9]{6}$/.test(resto) ? `VAL-${resto}` : limpio
}

/**
 * TDSI-73/74: metodo "Vale" en Pagos. El cajero escribe el codigo y, al salir del campo, se consulta el saldo
 * disponible. Si el vale no cubre el total, se sugiere completar el resto con otro metodo (pago mixto).
 *   info: { estado: 'cargando'|'ok'|'error', vale, error } (lo guarda Pagos para validar antes de cobrar)
 */
function CampoVale({ codigo, onCodigo, info, onInfo, total, esMixto, onCompletarConOtroMetodo }) {
  const [tocado, setTocado] = useState(false)

  async function consultar() {
    const normalizado = normalizarCodigoVale(codigo)
    if (normalizado !== codigo) onCodigo(normalizado)
    setTocado(true)
    if (!normalizado) return onInfo(null)
    if (!FORMATO_VALE.test(normalizado)) {
      return onInfo({ estado: 'error', error: 'El código del vale tiene el formato VAL-XXXXXX.' })
    }
    if (info?.vale?.codigo === normalizado && info.estado === 'ok') return undefined
    onInfo({ estado: 'cargando' })
    try {
      const r = await consultarVale(normalizado)
      onInfo({ estado: 'ok', vale: r.data })
    } catch (err) {
      onInfo({ estado: 'error', error: err.status === 404 ? `No existe el vale ${normalizado}.` : err.message })
    }
    return undefined
  }

  const vale = info?.estado === 'ok' ? info.vale : null
  const sinSaldo = vale && !vale.utilizable
  const faltante = vale && vale.utilizable && total > 0 ? Math.round((total - vale.saldo_disponible) * 100) / 100 : 0

  return (
    <div className="vxp-card" style={{ margin: '0.25rem 0 1rem', padding: '1rem' }}>
      <label className={`vxp-campo${tocado && info?.estado === 'error' ? ' vxp-campo--error' : ''}`}>
        Código del vale
        <div className="vxp-buscador-campo">
          <Icono nombre="vale" tam={19} />
          <input
            value={codigo}
            onChange={(e) => {
              onCodigo(e.target.value.toUpperCase())
              if (info) onInfo(null)
            }}
            onBlur={consultar}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                consultar()
              }
            }}
            placeholder="VAL-4F8K2A"
            maxLength={10}
            autoComplete="off"
            aria-label="Código del vale"
          />
        </div>
        <small>Al salir del campo se consulta el saldo disponible.</small>
      </label>

      {info?.estado === 'cargando' && (
        <div className="vxp-fila" style={{ marginTop: 10, color: 'var(--vxp-texto-suave)', fontSize: '0.85rem' }}>
          <span className="vxp-spinner" style={{ width: 14, height: 14 }} /> Consultando el vale...
        </div>
      )}
      {info?.estado === 'error' && (
        <div style={{ marginTop: 10 }}>
          <Aviso tono="bad" titulo={info.error} />
        </div>
      )}

      {vale && (
        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          {sinSaldo ? (
            <Aviso tono="bad" titulo="El vale no tiene saldo disponible">
              {vale.mensaje ?? `Estado: ${vale.estado}`}
            </Aviso>
          ) : (
            <div className="vxp-resumen-total" style={{ background: 'linear-gradient(135deg,#7a5a00,#d4a017)' }}>
              <div>
                <small style={{ color: 'rgba(255,255,255,.8)' }}>Saldo disponible · {vale.codigo}</small>
                <span className="vxp-monto">{bs(vale.saldo_disponible)}</span>
              </div>
              <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'rgba(255,255,255,.88)' }}>
                <span className="vxp-badge vxp-badge--ok" style={{ background: 'rgba(255,255,255,.9)' }}>
                  {vale.estado}
                </span>
                <div style={{ marginTop: 4 }}>Vence el {fecha(vale.vence_en)}</div>
              </div>
            </div>
          )}
          {!sinSaldo && !esMixto && faltante > 0 && (
            <Aviso
              tono="warn"
              titulo={`El vale no cubre todo el total: faltan ${bs(faltante)}`}
              accion={
                <Boton variante="oro" tam="sm" icono="lista" onClick={() => onCompletarConOtroMetodo(vale.saldo_disponible, faltante)}>
                  Completar con otro método
                </Boton>
              }
            >
              Se cobrarán {bs(vale.saldo_disponible)} con el vale y el resto con efectivo, tarjeta o QR.
            </Aviso>
          )}
          {!sinSaldo && !esMixto && faltante <= 0 && total > 0 && (
            <Aviso tono="ok" titulo="El vale cubre toda la venta">
              Quedarán {bs(Math.abs(faltante))} de saldo en el vale.
            </Aviso>
          )}
        </div>
      )}
    </div>
  )
}

export default CampoVale
