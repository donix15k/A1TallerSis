import { renderToStaticMarkup } from 'react-dom/server'
import { montoEnLetras } from '../../utils/numeroALetras.js'
import cssCupon from './Cupon.css?raw'
import './Cupon.css'

const ZONA = 'America/La_Paz'
// Una sola linea ("23 de noviembre de 2026, 23:26"): con "a las 11:26 p. m." bajaba a dos lineas y empujaba el pie del cupon fuera de su alto.
const fechaLarga = (v) =>
  `${new Date(v).toLocaleDateString('es-BO', { timeZone: ZONA, day: 'numeric', month: 'long', year: 'numeric' })}, ${new Date(v).toLocaleTimeString('es-BO', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false })}`
const fechaCorta = (v) => (v ? new Date(v).toLocaleDateString('es-BO', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
const montoCorto = (m) => {
  const n = Number(m) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')
}

/**
 * El cupon con el formato de un vale de consumo: logo, lugar y fecha, a favor de (nombre y NIT/CI), la suma en letras,
 * el monto grande, el codigo y la firma. `origen` = url base para las imagenes del logo (al imprimir, en otra ventana).
 */
export function CuponVale({ cupon, origen = '' }) {
  const anulado = cupon.estado && cupon.estado !== 'ACTIVO'
  return (
    <div className={`cupon${anulado ? ' cupon--anulado' : ''}`} role="img" aria-label={`Vale de consumo ${cupon.codigo} por ${montoCorto(cupon.monto)} bolivianos`}>
      <div className="cupon-deco" />
      <div className="cupon-cuerpo">
        <div className="cupon-cabecera">
          <span className="cupon-logo">
            <img src={`${origen}/brand/isotipo.png`} alt="" />
            <img src={`${origen}/brand/wordmark-light.png`} alt="Vortrix" />
          </span>
          <h3 className="cupon-titulo">
            VALE DE CONSUMO
            <small>VÁLIDO EN TODAS NUESTRAS SUCURSALES</small>
          </h3>
        </div>
        <dl style={{ margin: 0 }}>
          <div className="cupon-fila">
            <dt>Lugar y fecha</dt>
            <dd>Bolivia, {fechaLarga(cupon.emitido_en)}</dd>
          </div>
          <div className="cupon-fila cupon-fila--doble">
            <dt>En favor de</dt>
            <dd>{(cupon.cliente_nombre || 'Cliente').toUpperCase()}</dd>
            <span className="cupon-etq">C.I. / NIT</span>
            <dd>{cupon.cliente_nit || '—'}</dd>
          </div>
          <div className="cupon-fila">
            <dt>La suma de</dt>
            <dd>{montoEnLetras(cupon.monto)}</dd>
          </div>
        </dl>
        <div className="cupon-pie">
          <span>
            Devolución <strong>{cupon.devolucion_codigo}</strong> · Factura <strong>{cupon.factura_numero}</strong>
            <br />
            Vence el <strong>{fechaCorta(cupon.vence_en)}</strong> · No canjeable por dinero
          </span>
        </div>
      </div>
      <div className="cupon-talon">
        <div className="cupon-monto">
          <div>
            <strong>{montoCorto(cupon.monto)}</strong>
            <span>Bs</span>
          </div>
        </div>
        <span className="cupon-codigo">{cupon.codigo}</span>
        <span className="cupon-firma">Firma autorizada</span>
      </div>
    </div>
  )
}

/** Imprime SOLO el cupon (hoja apaisada del tamaño del cupon), en una ventana nueva. */
export function imprimirCupon(cupon) {
  const ventana = window.open('', '_blank', 'width=760,height=420')
  if (!ventana) return false
  const marcado = renderToStaticMarkup(<CuponVale cupon={cupon} origen={window.location.origin} />)
  ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cupón ${cupon.codigo}</title>
<style>
  @page { size: 160mm 62mm; margin: 0; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; background: #fff; }
  body { display: grid; place-items: center; min-height: 100vh; }
  .cupon { --cupon-fondo: #fff; box-shadow: none; transform-origin: center; }
  @media print { body { min-height: 0; } .cupon { zoom: 0.99; } }
${cssCupon}
</style></head><body>${marcado}
<script>window.onload = function () { setTimeout(function () { window.focus(); window.print(); }, 250); };</script>
</body></html>`)
  ventana.document.close()
  return true
}
