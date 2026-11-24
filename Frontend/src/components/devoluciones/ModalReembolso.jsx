import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { consultarReembolso, reembolsarDevolucion, listarCupones } from '../../api/devoluciones.js'
import Modal from '../ui/Modal.jsx'
import Boton from '../ui/Boton.jsx'
import Icono from '../ui/Icono.jsx'
import { Aviso, Esqueleto } from '../ui/Aviso.jsx'
import { bs } from '../../utils/formato.js'
import ImpresoraCupon from './ImpresoraCupon.jsx'

const ICONO_TIPO = { EFECTIVO: 'dinero', REVERSION_TARJETA: 'tarjeta', REVERSION_QR: 'qr', VALE: 'vale' }
const NOMBRE_TIPO = { EFECTIVO: 'Efectivo de caja', REVERSION_TARJETA: 'Reversión de tarjeta', REVERSION_QR: 'Reversión de QR', VALE: 'Vale de compra' }

/** El error de Caja cuando el cajero no tiene turno abierto (o no le alcanza el efectivo) se explica con un titulo claro. */
function tituloError(mensaje = '') {
  if (/turno/i.test(mensaje)) return 'No hay un turno abierto en su caja'
  if (/efectivo|alcanza|suficiente/i.test(mensaje)) return 'No hay efectivo suficiente en la caja'
  return 'No se pudo reembolsar'
}

/**
 * TDSI-51/52: "Reembolsar" una devolucion APROBADA. Muestra como se devolvera el dinero segun el metodo de pago
 * original y el monto; al confirmar muestra lo que el cajero debe hacer: "Entregue Bs X al cliente" (efectivo) o
 * "Reversión enviada" (tarjeta/QR). Si no hay turno abierto, el error lo dice claramente.
 *   formasExtra: opciones adicionales de reembolso (TDSI-67: vale de compra).
 */
function ModalReembolso({ codigo, cajero, onCerrar, onReembolsada, permitirVale = false, renderResultadoExtra, origen }) {
  // TDSI-121: un pedido del Marketplace se devuelve revirtiendo el pago online: no se ofrece efectivo ni vale de caja.
  const esMarketplace = origen === 'MARKETPLACE'
  if (esMarketplace) permitirVale = false
  const [forma, setForma] = useState('ORIGINAL')
  const [plan, setPlan] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [errorPlan, setErrorPlan] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [cupon, setCupon] = useState(null) // el cupon del vale emitido: se muestra en la impresora ni bien se reembolsa

  useEffect(() => {
    let vigente = true
    setCargando(true)
    setErrorPlan(null)
    consultarReembolso(codigo, { forma })
      .then((r) => vigente && setPlan(r.data))
      .catch((err) => vigente && setErrorPlan(err.message))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [codigo, forma])

  // El cupon con todos sus datos (cliente, factura, fechas) sale de la lista de cupones; si no responde, se arma con lo que ya se tiene.
  async function mostrarCupon(vale) {
    let completo = null
    try {
      const r = await listarCupones({ q: vale.codigo, porPagina: 5 })
      completo = (r.data ?? []).find((c) => c.codigo === vale.codigo) ?? null
    } catch {
      completo = null
    }
    setCupon(
      completo ?? {
        codigo: vale.codigo,
        monto: vale.monto ?? vale.saldo_disponible,
        estado: 'ACTIVO',
        emitido_en: new Date().toISOString(),
        vence_en: vale.expira_en ?? vale.vence_en,
        devolucion_codigo: codigo,
        factura_numero: plan?.factura_numero ?? '',
        cliente_nombre: null,
        cliente_nit: null,
      },
    )
  }

  async function confirmar() {
    setEnviando(true)
    setError(null)
    try {
      const r = await reembolsarDevolucion(codigo, { cajero: cajero?.nombre, caja_id: cajero?.caja, forma })
      setResultado(r.data)
      onReembolsada?.(r.data)
      if (r.data?.vale) await mostrarCupon(r.data.vale)
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  const efectivo = resultado?.reembolsos?.find((r) => r.tipo === 'EFECTIVO')
  const reversiones = resultado?.reembolsos?.filter((r) => r.tipo === 'REVERSION_TARJETA' || r.tipo === 'REVERSION_QR') ?? []

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      bloqueado={enviando}
      ancho={540}
      icono={resultado ? 'checkCirculo' : 'dinero'}
      tono={resultado ? 'ok' : undefined}
      titulo={resultado ? `${codigo} reembolsada` : `Reembolsar ${codigo}`}
      subtitulo={resultado ? 'La devolución quedó PROCESADA.' : 'Revise cómo se devolverá el dinero antes de confirmar.'}
      pie={
        resultado ? (
          <Boton variante="negro" onClick={onCerrar}>
            Listo
          </Boton>
        ) : (
          <>
            <Boton variante="claro" onClick={onCerrar} disabled={enviando}>
              Cancelar
            </Boton>
            <Boton variante="exito" icono="check" cargando={enviando} disabled={cargando || Boolean(errorPlan)} onClick={confirmar}>
              Confirmar reembolso
            </Boton>
          </>
        )
      }
    >
      {!resultado && (
        <>
          {permitirVale && (
            <div className="vxp-segmentos" role="radiogroup" aria-label="Forma de reembolso" style={{ alignSelf: 'flex-start' }}>
              {[
                { id: 'ORIGINAL', etiqueta: 'Como pagó el cliente', icono: 'dinero' },
                { id: 'VALE', etiqueta: 'Vale de compra', icono: 'vale' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={forma === f.id}
                  className={`vxp-segmento${forma === f.id ? ' vxp-segmento--activo' : ''}`}
                  onClick={() => setForma(f.id)}
                  disabled={enviando}
                >
                  <Icono nombre={f.icono} tam={15} />
                  {f.etiqueta}
                </button>
              ))}
            </div>
          )}

          {cargando ? (
            <Esqueleto filas={3} alto={44} />
          ) : errorPlan ? (
            <Aviso tono="bad" titulo="No se puede reembolsar">
              {errorPlan}
            </Aviso>
          ) : (
            <>
              <div className="vxp-resumen-total">
                <div>
                  <small>Monto a devolver</small>
                  <span className="vxp-monto">{bs(plan.monto_total)}</span>
                </div>
                <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'rgba(223,232,245,.85)' }}>
                  <div>Factura {plan.factura_numero}</div>
                  {plan.metodo_pago && <div>Pagó con {plan.metodo_pago}</div>}
                </div>
              </div>
              {esMarketplace && (
                <Aviso tono="info" titulo="Pedido del Marketplace">
                  Se revierte el pago online del cliente. Nunca sale efectivo de la caja.
                </Aviso>
              )}
              <div style={{ display: 'grid', gap: 8 }}>
                {plan.plan.filter((p) => !(esMarketplace && p.tipo === 'EFECTIVO')).map((p) => (
                  <div key={p.tipo} className="vxp-dato" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="vxp-modal-icono" style={{ width: 36, height: 36 }}>
                      <Icono nombre={ICONO_TIPO[p.tipo] ?? 'dinero'} tam={17} />
                    </span>
                    <div style={{ flex: 1 }}>
                      <strong style={{ display: 'block', color: 'var(--vx-navy)' }}>{NOMBRE_TIPO[p.tipo] ?? p.tipo}</strong>
                      <span className="vxp-texto-suave" style={{ fontSize: '0.8rem' }}>{p.descripcion}</span>
                    </div>
                    <span className="vxp-monto">{bs(p.monto)}</span>
                  </div>
                ))}
              </div>
              {plan.sale_efectivo_de_caja && (
                <Aviso tono="warn" titulo="Sale efectivo de su caja">
                  Se registrará una salida en su turno abierto ({cajero?.caja}) con el concepto “Devolución {codigo}”.
                </Aviso>
              )}
            </>
          )}

          {error && (
            <Aviso tono="bad" titulo={tituloError(error)}>
              {error}
            </Aviso>
          )}
        </>
      )}

      {resultado && (
        <div className="vxp-escalon" style={{ display: 'grid', gap: 10 }}>
          {efectivo && (
            <div className="vxp-resumen-total" style={{ background: 'linear-gradient(135deg,#0f7a53,#19a874)' }}>
              <div>
                <small style={{ color: 'rgba(255,255,255,.8)' }}>Efectivo</small>
                <span className="vxp-monto">Entregue {bs(efectivo.monto)} al cliente</span>
              </div>
              <Icono nombre="dinero" tam={30} />
            </div>
          )}
          {reversiones.map((r) => (
            <Aviso key={r.id} tono="ok" titulo="Reversión enviada">
              {bs(r.monto)} del cobro con {r.tipo === 'REVERSION_QR' ? 'QR' : 'tarjeta'}
              {r.envio && r.envio.estado !== 'ENVIADO' ? ' · la pasarela la confirmará en breve' : ''}
            </Aviso>
          ))}
          {resultado.vale && (
            <Aviso tono="ok" titulo={`Vale ${resultado.vale.codigo} emitido`}>
              El cupón se imprime con el diseño del vale de consumo.{' '}
              <Boton variante="negro" tam="sm" icono="imprimir" onClick={() => mostrarCupon(resultado.vale)} style={{ marginTop: 8 }}>
                Ver e imprimir cupón
              </Boton>
            </Aviso>
          )}
          {resultado.mensajes
            ?.filter((m) => !/^Entregue|^Reversión|^Vale /.test(m))
            .map((m) => (
              <Aviso key={m} tono="info">
                {m}
              </Aviso>
            ))}
          {renderResultadoExtra?.(resultado)}
        </div>
      )}
      {cupon && createPortal(<ImpresoraCupon cupon={cupon} onCerrar={() => setCupon(null)} />, document.body)}
    </Modal>
  )
}

export default ModalReembolso
