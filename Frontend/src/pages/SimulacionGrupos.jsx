import { irConRecarga } from '../components/simulacion/MarcoSimulacion.jsx'
import Icono from '../components/ui/Icono.jsx'
import '../styles/simulacion.css'

const GRUPOS_SIMULABLES = [
  {
    vista: 'contabilidad', letra: 'D', titulo: 'Contabilidad', topico: 'ucb-sis323-sub-d',
    puntos: ['Ver los asientos que le enviamos: facturas, anulaciones, notas de crédito y diferencias de caja', 'Aceptarlos (con su N° de asiento) o rechazarlos con un motivo', 'Pagos y Facturación los marca como registrados o rechazados'],
  },
  {
    vista: 'marketplace', letra: 'E', titulo: 'Marketplace y Ventas', topico: 'ucb-sis323-sub-e',
    puntos: ['Elegir los productos y cantidades de un pedido online', 'Enviar la venta por Pub/Sub al grupo A1', 'Se factura y aparece en Ventas online al volver'],
  },
  {
    vista: 'compras', letra: 'C', titulo: 'Compras y Proveedores', topico: 'ucb-sis323-sub-c',
    puntos: ['Confirmar la recepción de nuestro reporte de productos vendidos', 'Entregar órdenes de pago aprobadas a Pagos a Proveedores', 'Los reportes pasan a Recibido y las órdenes llegan a la bandeja'],
  },
]

function TarjetaGrupo({ g }) {
  return (
    <article className={`simc-tarjeta simc-tarjeta--${g.vista}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="simc-letra">{g.letra}</span>
        <div>
          <h2>{g.titulo}</h2>
          <small>Grupo {g.letra}</small>
        </div>
      </div>
      <ul>
        {g.puntos.map((p) => (
          <li key={p}><Icono nombre="checkCirculo" tam={17} /> {p}</li>
        ))}
      </ul>
      <div className="simc-topico">Tópico del grupo: <code>{g.topico}</code></div>
      <button type="button" className="simc-ir" onClick={() => irConRecarga(`/simulacion/${g.vista}`)}>
        Ver desde {g.titulo.split(' ')[0]} <Icono nombre="flecha" tam={19} />
      </button>
    </article>
  )
}

function SimulacionGrupos() {
  return (
    <div className="simc">
      <section className="simc-hero">
        <h1>Simulación de grupos</h1>
        <p>
          Cada integración necesita a otro grupo del otro lado. Aquí puedes <strong>ponerte en su lugar</strong>: entras a la vista de Contabilidad, del Marketplace o de Compras,
          envías lo que ellos enviarían —siempre por <strong>Pub/Sub real</strong>— y al volver Pagos y Facturación ya lo recibió, como si el otro grupo existiera.
        </p>
        <div className="simc-flujo" aria-label="Flujo de la simulación">
          <span className="nodo">Otro grupo (D, E o C)</span>
          <Icono nombre="flecha" tam={20} />
          <span className="nodo">Tópico de A1</span>
          <Icono nombre="flecha" tam={20} />
          <span className="nodo nodo--a1">Pagos y Facturación (A1)</span>
        </div>
      </section>

      <div className="simc-tarjetas">
        {GRUPOS_SIMULABLES.map((g) => <TarjetaGrupo key={g.vista} g={g} />)}
      </div>
    </div>
  )
}

export default SimulacionGrupos
