import { bs, numero } from '../../utils/formato.js'

// Clave de una fila de producto (descripcion + precio): es lo que identifica una linea de la factura.
export const claveProducto = (it) => `${String(it.descripcion).trim().toLowerCase()}|${Number(it.precio_unitario).toFixed(2)}`

const cantidadTexto = (n) => numero(n, Number.isInteger(n) ? 0 : 2)
const redondear = (n) => Math.round(n * 100) / 100

/** Contador - [n] + que nunca baja de 1 ni pasa del maximo disponible. */
function Contador({ valor, maximo, onCambiar, etiqueta }) {
  const paso = Number.isInteger(maximo) ? 1 : 0.5
  const fijar = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return
    onCambiar(Math.min(maximo, Math.max(0, redondear(n))))
  }
  return (
    <div className="vxp-stepper">
      <button type="button" onClick={() => fijar(valor - paso)} disabled={valor <= paso} aria-label={`Restar ${etiqueta}`}>
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={maximo}
        step="any"
        value={valor}
        onChange={(e) => fijar(e.target.value)}
        onFocus={(e) => e.target.select()}
        aria-label={`Cantidad de ${etiqueta}`}
      />
      <button type="button" onClick={() => fijar(valor + paso)} disabled={valor >= maximo} aria-label={`Sumar ${etiqueta}`}>
        +
      </button>
    </div>
  )
}

/**
 * TDSI-14/15/25: productos de la factura con la cantidad comprada, la ya devuelta y la que todavia se puede
 * devolver. El cajero marca que productos devuelve y cuantos (nunca mas que lo disponible). Si la factura no
 * se puede devolver (fuera de plazo o anulada) la seleccion queda deshabilitada.
 *   seleccion: { [clave]: { cantidad } }  (solo las filas elegidas)
 */
function TablaProductosDevolucion({ items, devolvible, seleccion = {}, onAlternar, onCantidad, columnaExtra }) {
  const algunaElegida = Object.keys(seleccion).length > 0
  return (
    <div className="vxp-tabla-envoltura">
      <table className="vxp-tabla">
        <thead>
          <tr>
            <th style={{ width: 44 }} aria-label="Elegir" />
            <th>Producto</th>
            <th className="num">P. unitario</th>
            <th className="num">Comprada</th>
            <th className="num">Ya devuelta</th>
            <th className="num">Disponible</th>
            {algunaElegida && <th style={{ textAlign: 'center' }}>A devolver</th>}
            {algunaElegida && columnaExtra && <th>{columnaExtra.titulo}</th>}
            {algunaElegida && <th className="num">Subtotal</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const clave = claveProducto(it)
            const sinDisponible = it.cantidad_disponible <= 0
            const deshabilitada = !devolvible || sinDisponible
            const elegida = seleccion[clave]
            return (
              <tr
                key={clave}
                className={[elegida && 'vxp-fila--seleccionada', deshabilitada && 'vxp-fila--deshabilitada'].filter(Boolean).join(' ') || undefined}
              >
                <td>
                  <label className="vxp-check" title={!devolvible ? 'La factura no se puede devolver' : sinDisponible ? 'Ya se devolvió todo' : 'Elegir producto'}>
                    <input
                      type="checkbox"
                      checked={Boolean(elegida)}
                      disabled={deshabilitada}
                      onChange={() => onAlternar?.(it)}
                      aria-label={`Devolver ${it.descripcion}`}
                    />
                  </label>
                </td>
                <td style={{ fontWeight: 600 }}>{it.descripcion}</td>
                <td className="num">{bs(it.precio_unitario)}</td>
                <td className="num">{cantidadTexto(it.cantidad_comprada)}</td>
                <td className="num">{it.cantidad_devuelta > 0 ? cantidadTexto(it.cantidad_devuelta) : '—'}</td>
                <td className="num">
                  <span className={`vxp-badge ${!sinDisponible && devolvible ? 'vxp-badge--ok' : 'vxp-badge--neutro'}`}>{cantidadTexto(it.cantidad_disponible)}</span>
                </td>
                {algunaElegida && (
                  <td style={{ textAlign: 'center' }}>
                    {elegida ? (
                      <Contador valor={elegida.cantidad} maximo={it.cantidad_disponible} etiqueta={it.descripcion} onCambiar={(v) => onCantidad?.(it, v)} />
                    ) : (
                      <span className="vxp-texto-suave">—</span>
                    )}
                  </td>
                )}
                {algunaElegida && columnaExtra && <td>{elegida ? columnaExtra.render(it, elegida) : <span className="vxp-texto-suave">—</span>}</td>}
                {algunaElegida && (
                  <td className="num vxp-monto">{elegida ? bs(redondear(elegida.cantidad * it.precio_unitario)) : <span className="vxp-texto-suave">—</span>}</td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default TablaProductosDevolucion
