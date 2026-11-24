import Modal from '../ui/Modal.jsx'
import Boton from '../ui/Boton.jsx'
import { Aviso } from '../ui/Aviso.jsx'
import { PuntoSemaforo } from './TarjetaKPI.jsx'
import { COLOR_NOMBRE } from './detalleKpi.js'

/**
 * Ventana que se abre al hacer clic en una tarjeta del Resumen: el nombre del KPI, que mide, su formula, la cuenta hecha con los valores reales del
 * periodo, el resultado con su color y los limites del semaforo (el color actual va marcado). "Ver más" lleva a la pestaña donde esta el detalle completo.
 */
function ModalDetalleKpi({ detalle, periodo, onCerrar, onVerMas }) {
  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      ancho={600}
      icono="grafico"
      titulo={detalle.nombre}
      subtitulo={`Cómo se calculó · ${periodo}`}
      pie={
        <>
          <Boton variante="claro" onClick={onCerrar}>
            Cerrar
          </Boton>
          <Boton variante="negro" onClick={onVerMas}>
            Ver más en {detalle.pestanaNombre}
          </Boton>
        </>
      }
    >
      <div className="kpi-det">
        <section>
          <h4>Qué mide</h4>
          <p>{detalle.queMide}</p>
        </section>

        <section>
          <h4>Fórmula</h4>
          <p className="kpi-det-formula">{detalle.formula}</p>
        </section>

        <section>
          <h4>Valores que se usaron</h4>
          <dl className="kpi-det-valores">
            {detalle.valores.map((v) => (
              <div key={v.etiqueta}>
                <dt>
                  {v.etiqueta}
                  {v.nota && <small>{v.nota}</small>}
                </dt>
                <dd>{v.valor}</dd>
              </div>
            ))}
          </dl>
          <p className="kpi-det-calculo">{detalle.calculo}</p>
        </section>

        <section className={`kpi-det-resultado${detalle.color ? ` kpi-det-resultado--${detalle.color}` : ''}`}>
          <div>
            <small>Resultado</small>
            <strong>{detalle.resultado}</strong>
          </div>
          <span className="kpi-det-estado">
            <PuntoSemaforo color={detalle.color} />
            {detalle.color ? COLOR_NOMBRE[detalle.color] : 'Sin datos'}
          </span>
        </section>

        {detalle.aviso && (
          <Aviso tono="warn" titulo="Dato incompleto">
            {detalle.aviso}
          </Aviso>
        )}

        <section>
          <h4>Semáforo</h4>
          <ul className="kpi-det-semaforo">
            {detalle.semaforo.map((s) => (
              <li key={s.color} className={detalle.color === s.color ? 'kpi-det-semaforo--actual' : undefined}>
                <PuntoSemaforo color={s.color} /> <b>{COLOR_NOMBRE[s.color]}</b> {s.texto}
                {detalle.color === s.color && <em> ← está aquí</em>}
              </li>
            ))}
          </ul>
        </section>

        {detalle.extra && detalle.extra.filas.length > 0 && (
          <section>
            <h4>{detalle.extra.titulo}</h4>
            <ul className="kpi-det-lista">
              {detalle.extra.filas.map(([a, b], i) => (
                <li key={i}>
                  <span>{a}</span>
                  <b>{b}</b>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h4>Qué hacer si no está en verde</h4>
          <p>{detalle.decision}</p>
        </section>
      </div>
    </Modal>
  )
}

export default ModalDetalleKpi
