import Boton from '../ui/Boton.jsx'
import { bs, fecha } from '../../utils/formato.js'

const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Abre el vale en una ventana con formato de tirilla (80 mm) y lanza la impresion. */
export function imprimirVale(vale, { devolucion } = {}) {
  const ventana = window.open('', '_blank', 'width=420,height=620')
  if (!ventana) return false
  ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Vale ${escapar(vale.codigo)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'JetBrains Mono', Consolas, monospace; color: #06152f; }
  .vale { width: 72mm; margin: 0 auto; padding: 4mm 3mm; border: 1.5px dashed #06152f; border-radius: 6px; text-align: center; }
  h1 { font-size: 15px; margin: 0 0 2mm; letter-spacing: .08em; }
  .marca { font-size: 11px; letter-spacing: .3em; color: #315a91; }
  .codigo { font-size: 22px; font-weight: 800; letter-spacing: .08em; margin: 4mm 0; padding: 2mm 0; border-top: 1px solid #c5cbd4; border-bottom: 1px solid #c5cbd4; }
  .saldo { font-size: 20px; font-weight: 800; margin: 2mm 0; }
  p { font-size: 10.5px; margin: 1.2mm 0; }
  .nota { margin-top: 4mm; font-size: 9px; color: #5b6676; }
</style></head><body>
<div class="vale">
  <div class="marca">VORTRIX</div>
  <h1>VALE DE COMPRA</h1>
  <div class="codigo">${escapar(vale.codigo)}</div>
  <p>Saldo</p>
  <div class="saldo">${escapar(bs(vale.saldo_disponible ?? vale.monto))}</div>
  <p>Válido hasta el <strong>${escapar(fecha(vale.expira_en ?? vale.vence_en))}</strong></p>
  ${devolucion ? `<p>Devolución ${escapar(devolucion)}</p>` : ''}
  <p class="nota">Presente este código al pagar. No se cambia por dinero. Puede usarse en varias compras hasta agotar el saldo.</p>
</div>
<script>window.onload = function () { window.focus(); window.print(); };</script>
</body></html>`)
  ventana.document.close()
  return true
}

/** TDSI-72: el vale emitido al reembolsar, con su codigo, saldo y fecha de vencimiento, listo para imprimir. */
function ValeCompra({ vale, devolucion }) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'grid',
        gap: 6,
        justifyItems: 'center',
        padding: '1.1rem 1rem',
        borderRadius: 16,
        color: '#2b1d00',
        background: 'radial-gradient(120% 120% at 100% 0%, rgba(255,255,255,.55), transparent 55%), linear-gradient(135deg,#f6d77a,#d4a017)',
        boxShadow: '0 16px 34px -18px rgba(120,85,0,.7), inset 0 1px 0 rgba(255,255,255,.5)',
        border: '1.5px dashed rgba(43,29,0,.35)',
      }}
    >
      <span style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.24em' }}>VALE DE COMPRA</span>
      <span className="vxp-codigo" style={{ fontSize: '1.6rem', letterSpacing: '0.08em' }}>{vale.codigo}</span>
      <span className="vxp-monto" style={{ fontSize: '1.35rem' }}>{bs(vale.saldo_disponible ?? vale.monto)}</span>
      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Válido hasta el {fecha(vale.expira_en ?? vale.vence_en)}</span>
      <Boton variante="negro" tam="sm" icono="imprimir" onClick={() => imprimirVale(vale, { devolucion })} style={{ marginTop: 6 }}>
        Imprimir vale
      </Boton>
    </div>
  )
}

export default ValeCompra
