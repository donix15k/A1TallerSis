import './ReciboTermico.css'

// Comprobante de venta con aspecto de recibo termico. Pinta el MISMO modelo que el PDF
// (lo arma el backend en comprobanteModelo.js), asi que texto, orden y secciones coinciden.
function Filas({ filas, negrita = false }) {
  return filas.map(([izquierda, derecha]) => (
    <div className={`vx-recibo-fila${negrita ? ' vx-recibo-fila--negrita' : ''}`} key={`${izquierda}-${derecha}`}>
      <span>{izquierda}</span>
      <span>{derecha}</span>
    </div>
  ))
}

function ReciboTermico({ modelo, qr }) {
  return (
    <div className="vx-recibo">
      <img className="vx-recibo-logo" src="/brand/lockup-dark.png" alt="Vortrix" draggable="false" />
      <p className="vx-recibo-lema">Gestión de pagos y facturación</p>

      <div className="vx-recibo-empresa">
        <span>{modelo.empresa.direccion}</span>
        <span>NIT: {modelo.empresa.nit}</span>
        {modelo.puntoVenta && <span>{modelo.puntoVenta}</span>}
      </div>

      <hr className="vx-recibo-linea" />
      <h3 className="vx-recibo-titulo">{modelo.titulo}</h3>
      {modelo.anulada && <div className="vx-recibo-anulada">ANULADA</div>}

      <hr className="vx-recibo-linea" />
      <Filas filas={modelo.datos} />
      <p className="vx-recibo-atendido">{modelo.atendidoPor}</p>

      <hr className="vx-recibo-linea" />
      <Filas filas={modelo.cliente} />

      <hr className="vx-recibo-linea" />
      <Filas filas={[modelo.detalle.encabezado]} negrita />
      <Filas filas={modelo.detalle.filas} />

      <div className="vx-recibo-total">
        <span>TOTAL Bs.</span>
        <strong>{modelo.total}</strong>
      </div>
      <p className="vx-recibo-son">{modelo.son}</p>

      <hr className="vx-recibo-linea" />
      <div className="vx-recibo-qr">
        <img src={qr} alt="Código QR para verificar la factura" draggable="false" />
      </div>
      <p className="vx-recibo-qr-texto">{modelo.qrTexto}</p>

      <div className="vx-recibo-pie">
        {modelo.pie.map((linea) => (
          <p key={linea}>{linea}</p>
        ))}
        <strong>{modelo.gracias}</strong>
      </div>
    </div>
  )
}

export default ReciboTermico
