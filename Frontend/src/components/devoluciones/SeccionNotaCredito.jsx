import { useCallback, useEffect, useState } from 'react'
import { enviarNotaCreditoPorCorreo, obtenerClientePorNit, obtenerNotaCredito, urlNotaCreditoPdf } from '../../api/devoluciones.js'
import Boton from '../ui/Boton.jsx'
import Icono from '../ui/Icono.jsx'
import Modal from '../ui/Modal.jsx'
import { Aviso, Esqueleto } from '../ui/Aviso.jsx'
import { useToast } from '../ui/Toasts.jsx'
import { bs, fechaHora } from '../../utils/formato.js'

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Imprime el PDF sin salir de la pantalla: lo carga en un iframe oculto y abre el dialogo de impresion. */
async function imprimirPdf(url) {
  const respuesta = await fetch(url)
  if (!respuesta.ok) throw new Error('No se pudo obtener la nota de crédito.')
  const blob = await respuesta.blob()
  const objeto = URL.createObjectURL(blob)
  const marco = document.createElement('iframe')
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  marco.src = objeto
  document.body.appendChild(marco)
  marco.onload = () => {
    try {
      marco.contentWindow.focus()
      marco.contentWindow.print()
    } catch {
      window.open(objeto, '_blank', 'noopener')
    }
    setTimeout(() => {
      marco.remove()
      URL.revokeObjectURL(objeto)
    }, 60000)
  }
}

/** TDSI-62: "Enviar por correo" con el correo del cliente precargado y editable, validando su formato. */
function ModalEnviarCorreo({ devolucion, nota, onCerrar, onEnviado }) {
  const [email, setEmail] = useState(nota.enviada_a ?? '')
  const [tocado, setTocado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (nota.enviada_a || !devolucion.cliente_nit || devolucion.cliente_nit === '0') return
    obtenerClientePorNit(devolucion.cliente_nit)
      .then((r) => r.data?.email && setEmail((actual) => actual || r.data.email))
      .catch(() => {})
  }, [devolucion.cliente_nit, nota.enviada_a])

  const invalido = !CORREO_VALIDO.test(email.trim())

  async function enviar(e) {
    e.preventDefault()
    setTocado(true)
    if (invalido) {
      setError('El correo no es válido')
      return
    }
    setEnviando(true)
    setError(null)
    try {
      const r = await enviarNotaCreditoPorCorreo(devolucion.codigo, email.trim())
      onEnviado(r)
    } catch (err) {
      setError(err.message)
      setEnviando(false)
    }
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      bloqueado={enviando}
      icono="correo"
      titulo="Enviar por correo"
      subtitulo={`Se enviará el PDF de la nota de crédito ${nota.numero} al cliente.`}
      pie={
        <>
          <Boton variante="claro" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Boton>
          <Boton type="submit" form="form-enviar-nc" icono="enviar" cargando={enviando}>
            Enviar
          </Boton>
        </>
      }
    >
      <form id="form-enviar-nc" onSubmit={enviar} noValidate>
        <label className={`vxp-campo${tocado && invalido ? ' vxp-campo--error' : ''}`}>
          Correo del cliente
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (error) setError(null)
            }}
            onBlur={() => setTocado(true)}
            placeholder="cliente@correo.com"
            autoComplete="off"
          />
          {tocado && invalido && email && <span className="vxp-campo-error">El correo no es válido</span>}
        </label>
      </form>
      {error && (
        <Aviso tono="bad" titulo={error === 'El correo no es válido' ? error : 'No se pudo enviar'}>
          {error === 'El correo no es válido' ? 'Revise que tenga el formato nombre@dominio.com.' : error}
        </Aviso>
      )}
    </Modal>
  )
}

/**
 * TDSI-61/63: en el detalle de una devolucion PROCESADA: numero de la nota de credito, su estado de envio
 * ("Enviado el ... a ...") y los botones "Ver nota de crédito", "Imprimir" y "Enviar por correo".
 */
function SeccionNotaCredito({ devolucion }) {
  const [nota, setNota] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [enviarAbierto, setEnviarAbierto] = useState(false)
  const [imprimiendo, setImprimiendo] = useState(false)
  const toast = useToast()

  const cargar = useCallback(() => {
    setCargando(true)
    obtenerNotaCredito(devolucion.codigo)
      .then((r) => {
        setNota(r.data)
        setError(null)
      })
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false))
  }, [devolucion.codigo])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function imprimir() {
    setImprimiendo(true)
    try {
      await imprimirPdf(urlNotaCreditoPdf(devolucion.codigo))
    } catch (err) {
      toast.error('No se pudo imprimir', err.message)
    } finally {
      setTimeout(() => setImprimiendo(false), 600)
    }
  }

  return (
    <div style={{ marginTop: '1.1rem' }}>
      <hr className="vxp-separador" />
      <h3 className="vxp-card-titulo" style={{ fontSize: '0.95rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icono nombre="libro" tam={18} /> Nota de crédito
        </span>
      </h3>
      {cargando ? (
        <Esqueleto filas={2} alto={38} />
      ) : error ? (
        <Aviso tono="warn" titulo="Nota de crédito no disponible">
          {error}
        </Aviso>
      ) : (
        <div className="vxp-fila vxp-fila--entre" style={{ alignItems: 'center' }}>
          <div className="vxp-fila" style={{ gap: 14 }}>
            <span className="vxp-codigo-grande" style={{ fontSize: '1.05rem', padding: '0.45rem 0.8rem' }}>
              {nota.numero}
            </span>
            <div>
              <div className="vxp-monto" style={{ color: 'var(--vx-navy)' }}>{bs(nota.monto)}</div>
              <div style={{ fontSize: '0.82rem', marginTop: 2 }}>
                {nota.enviada_por_correo ? (
                  <span className="vxp-badge vxp-badge--ok">
                    Enviado el {fechaHora(nota.enviada_en)}
                    {nota.enviada_a ? ` a ${nota.enviada_a}` : ''}
                  </span>
                ) : (
                  <span className="vxp-badge vxp-badge--neutro">Sin enviar por correo · emitida el {fechaHora(nota.emitida_en)}</span>
                )}
              </div>
            </div>
          </div>
          <div className="vxp-fila">
            <Boton variante="claro" icono="ojo" onClick={() => window.open(urlNotaCreditoPdf(devolucion.codigo), '_blank', 'noopener')}>
              Ver nota de crédito
            </Boton>
            <Boton variante="claro" icono="imprimir" cargando={imprimiendo} onClick={imprimir}>
              Imprimir
            </Boton>
            <Boton icono="correo" onClick={() => setEnviarAbierto(true)}>
              Enviar por correo
            </Boton>
          </div>
        </div>
      )}

      {enviarAbierto && nota && (
        <ModalEnviarCorreo
          devolucion={devolucion}
          nota={nota}
          onCerrar={() => setEnviarAbierto(false)}
          onEnviado={(r) => {
            setEnviarAbierto(false)
            if (r.data.estado === 'SIMULADO') toast.aviso('Envío simulado', r.mensaje)
            else toast.ok('Nota de crédito enviada', `A ${r.data.email}`)
            cargar()
          }}
        />
      )}
    </div>
  )
}

export default SeccionNotaCredito
