import { bs, numero } from '../../utils/formato.js'

// Clave de una fila de producto (descripcion + precio): es lo que identifica una linea de la factura.
export const claveProducto = (it) => `${String(it.descripcion).trim().toLowerCase()}|${Number(it.precio_unitario).toFixed(2)}`

/**
 * TDSI-14/15: productos de la factura con la cantidad comprada, la ya devuelta y la que todavia se puede
 * devolver. Si la factura no se puede devolver (fuera de plazo o anulada) la seleccion queda deshabilitada.
 *   seleccion: { [clave]: { cantidad } }  (solo las filas elegidas)
 */
function TablaProductosDevolucion({ items, devolvible, seleccion = {}, onAlternar }) {
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
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const clave = claveProducto(it)
            const sinDisponible = it.cantidad_disponible <= 0
            const deshabilitada = !devolvible || sinDisponible
            const elegida = Boolean(seleccion[clave])
            return (
              <tr
                key={clave}
                className={[elegida && 'vxp-fila--seleccionada', deshabilitada && 'vxp-fila--deshabilitada'].filter(Boolean).join(' ') || undefined}
              >
                <td>
                  <label className="vxp-check" title={!devolvible ? 'La factura no se puede devolver' : sinDisponible ? 'Ya se devolvió todo' : 'Elegir producto'}>
                    <input
                      type="checkbox"
                      checked={elegida}
                      disabled={deshabilitada}
                      onChange={() => onAlternar?.(it)}
                      aria-label={`Devolver ${it.descripcion}`}
                    />
                  </label>
                </td>
                <td style={{ fontWeight: 600 }}>{it.descripcion}</td>
                <td className="num">{bs(it.precio_unitario)}</td>
                <td className="num">{numero(it.cantidad_comprada, Number.isInteger(it.cantidad_comprada) ? 0 : 2)}</td>
                <td className="num">{it.cantidad_devuelta > 0 ? numero(it.cantidad_devuelta, Number.isInteger(it.cantidad_devuelta) ? 0 : 2) : '—'}</td>
                <td className="num">
                  <span className={`vxp-badge ${sinDisponible ? 'vxp-badge--neutro' : devolvible ? 'vxp-badge--ok' : 'vxp-badge--neutro'}`}>
                    {numero(it.cantidad_disponible, Number.isInteger(it.cantidad_disponible) ? 0 : 2)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default TablaProductosDevolucion
