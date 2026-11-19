import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import VistaFactura from './VistaFactura.jsx'

// Boton "Ver factura": abre la vista previa animada (la impresora que va sacando el
// recibo). Reemplaza al enlace que abria el PDF suelto en otra pestana; desde la vista
// sigue estando el enlace "Ver PDF".
function BotonVerFactura({ idTransaccion, className = 'btn btn-azul', children = 'Ver' }) {
  const [abierta, setAbierta] = useState(false)
  const cerrar = useCallback(() => setAbierta(false), [])

  return (
    <>
      <button type="button" className={className} onClick={() => setAbierta(true)}>
        {children}
      </button>
      {abierta && createPortal(<VistaFactura idTransaccion={idTransaccion} onCerrar={cerrar} />, document.body)}
    </>
  )
}

export default BotonVerFactura
