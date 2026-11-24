import { bs, numero, porcentaje } from '../../utils/formato.js'

// Explicacion y calculo de cada KPI del Resumen: para el aviso al pasar el cursor (ayuda) y para la ventana que se abre al hacer clic
// (que mide, formula, los VALORES con que se llego al resultado, los limites del semaforo y que decision tomar).

export const AYUDA = {
  ticket_promedio: 'Cuánto gasta en promedio cada cliente por venta: el total vendido dividido entre el número de ventas válidas (sin las anuladas).',
  anulacion: 'Qué parte de las facturas emitidas se anula. Si sube, conviene revisar qué cajero y qué motivo concentran las anulaciones.',
  devoluciones: 'Cuánto del dinero vendido se devuelve a los clientes: monto devuelto dividido entre monto vendido.',
  metas: 'Cuánto avanzó cada caja respecto a su meta de ventas del mes: lo vendido dividido entre la meta.',
  cuadre: 'Cuántos turnos cierran con el efectivo exacto: turnos que cuadran entre turnos cerrados.',
  aceptacion: 'Cuántos asientos enviados a Contabilidad fueron registrados sin error: registrados entre enviados.',
  pago_proveedores: 'Cuántos días tardamos en promedio en pagar una orden de pago aprobada a un proveedor.',
}

const COLOR_NOMBRE = { VERDE: 'Verde', AMARILLO: 'Amarillo', ROJO: 'Rojo' }

// Limites del semaforo segun el sentido del KPI: MAYOR (mas es mejor: ticket, metas, cuadre, aceptacion) o MENOR (menos es mejor).
function semaforoMayor(u, unidad) {
  const f = (v) => (unidad === 'Bs' ? bs(v) : `${numero(v, v % 1 ? 1 : 0)} %`)
  return [
    { color: 'VERDE', texto: `${f(u.verde)} o más` },
    { color: 'AMARILLO', texto: `de ${f(u.amarillo)} a menos de ${f(u.verde)}` },
    { color: 'ROJO', texto: `menos de ${f(u.amarillo)}` },
  ]
}
function semaforoMenor(u, unidad) {
  const f = (v) => (unidad === 'días' ? `${numero(v, v % 1 ? 1 : 0)} días` : `${numero(v, v % 1 ? 1 : 0)} %`)
  return [
    { color: 'VERDE', texto: `hasta ${f(u.verde)}` },
    { color: 'AMARILLO', texto: `más de ${f(u.verde)} hasta ${f(u.amarillo)}` },
    { color: 'ROJO', texto: `más de ${f(u.amarillo)}` },
  ]
}

const fila = (etiqueta, valor, nota) => ({ etiqueta, valor, nota })

/**
 * Arma el detalle de un KPI a partir de lo que ya cargo el Panel (`datos`). Devuelve null si todavia no hay datos de ese KPI.
 *   { nombre, queMide, formula, calculo (la cuenta con los numeros), valores: [{ etiqueta, valor, nota }], resultado, color, semaforo, decision,
 *     extra: { titulo, filas } | null, aviso, pestana, pestanaNombre }
 */
export function construirDetalle(id, datos) {
  const { resumen, metas, cuadre, aceptacion, dias } = datos
  const tarjeta = (x) => resumen?.tarjetas?.find((t) => t.id === x)

  if (id === 'ticket_promedio') {
    const t = tarjeta('ticket_promedio')
    if (!t) return null
    const d = t.detalle ?? {}
    return {
      nombre: 'Ticket promedio',
      queMide: AYUDA.ticket_promedio,
      formula: 'Total vendido ÷ número de ventas válidas',
      calculo: d.sin_ventas ? 'No hubo ventas en el mes: no hay promedio.' : `${bs(d.total_vendido)} ÷ ${numero(d.ventas_validas)} ventas = ${bs(t.valor)}`,
      valores: [
        fila('Total vendido en el mes', bs(d.total_vendido), 'Suma de las ventas registradas y no anuladas'),
        fila('Ventas válidas', numero(d.ventas_validas), 'Las ventas anuladas no cuentan'),
        fila('Ventas anuladas (no incluidas)', numero(d.ventas_anuladas)),
      ],
      resultado: d.sin_ventas ? '—' : bs(t.valor),
      color: t.color,
      semaforo: semaforoMayor(d.umbrales ?? { verde: 45, amarillo: 35 }, 'Bs'),
      decision: 'Si baja, lanzar combos o promociones para que cada cliente compre más.',
      pestana: 'riesgo',
      pestanaNombre: 'Riesgo',
    }
  }

  if (id === 'anulacion') {
    const t = tarjeta('anulacion')
    if (!t) return null
    const d = t.detalle ?? {}
    return {
      nombre: 'Tasa de anulación',
      queMide: AYUDA.anulacion,
      formula: 'Facturas anuladas ÷ facturas emitidas × 100',
      calculo: d.sin_facturas ? 'No se emitieron facturas en el mes.' : `${numero(d.anuladas)} ÷ ${numero(d.emitidas)} × 100 = ${porcentaje(t.valor)}`,
      valores: [fila('Facturas emitidas en el mes', numero(d.emitidas), 'Incluye las que luego se anularon'), fila('Facturas anuladas', numero(d.anuladas))],
      resultado: d.sin_facturas ? '—' : porcentaje(t.valor),
      color: t.color,
      semaforo: semaforoMenor(d.umbrales ?? { verde: 2, amarillo: 5 }, '%'),
      decision: 'Revisar qué cajero y qué motivo concentran las anulaciones (pestaña Riesgo).',
      pestana: 'riesgo',
      pestanaNombre: 'Riesgo',
    }
  }

  if (id === 'devoluciones') {
    const t = tarjeta('devoluciones')
    if (!t) return null
    const d = t.detalle ?? {}
    const sinDato = d.disponible === false
    return {
      nombre: 'Tasa de devoluciones',
      queMide: AYUDA.devoluciones,
      formula: 'Monto devuelto ÷ monto vendido × 100',
      calculo: sinDato ? 'El servicio de Devoluciones no respondió: no se pudo calcular.' : `${bs(d.monto_devuelto)} ÷ ${bs(d.monto_vendido)} × 100 = ${porcentaje(t.valor)}`,
      valores: [fila('Monto devuelto a clientes', sinDato ? '—' : bs(d.monto_devuelto), 'Devoluciones reembolsadas en el mes'), fila('Monto vendido en el mes', bs(d.monto_vendido))],
      resultado: sinDato ? '—' : porcentaje(t.valor),
      color: sinDato ? null : t.color,
      semaforo: semaforoMenor(d.umbrales ?? { verde: 1.5, amarillo: 3 }, '%'),
      decision: 'Revisar los productos y los motivos más devueltos (pestaña Riesgo).',
      aviso: sinDato ? d.error : null,
      pestana: 'riesgo',
      pestanaNombre: 'Riesgo',
    }
  }

  if (id === 'metas') {
    if (!metas) return null
    const g = metas.general ?? {}
    const sin = g.porcentaje === null || g.porcentaje === undefined
    return {
      nombre: 'Cumplimiento de metas',
      queMide: AYUDA.metas,
      formula: 'Ventas de la caja ÷ meta de la caja × 100',
      calculo: sin ? 'No hay metas configuradas: configúrelas en "Configurar objetivos".' : `${bs(g.vendido)} ÷ ${bs(g.meta)} × 100 = ${numero(g.porcentaje, g.porcentaje % 1 ? 1 : 0)} %`,
      valores: [fila('Vendido por todas las cajas', bs(g.vendido)), fila('Meta de todas las cajas', sin ? '—' : bs(g.meta), 'Suma de las metas del mes de cada caja')],
      resultado: sin ? '—' : `${numero(g.porcentaje, g.porcentaje % 1 ? 1 : 0)} %`,
      color: sin ? null : g.color,
      semaforo: semaforoMayor(metas.umbrales ?? { verde: 100, amarillo: 70 }, '%'),
      extra: {
        titulo: 'Por caja',
        filas: (metas.cajas ?? []).map((c) => [
          c.caja_nombre || c.caja_id,
          c.porcentaje === null || c.porcentaje === undefined ? 'Sin meta' : `${bs(c.vendido)} de ${bs(c.meta)} · ${numero(c.porcentaje, c.porcentaje % 1 ? 1 : 0)} %`,
        ]),
      },
      decision: 'Reforzar personal u horario en las cajas que están por debajo de su meta.',
      pestana: 'cajas',
      pestanaNombre: 'Cajas',
    }
  }

  if (id === 'cuadre') {
    if (!cuadre) return null
    const sin = cuadre.sin_turnos
    return {
      nombre: 'Efectividad de cuadre',
      queMide: AYUDA.cuadre,
      formula: 'Turnos que cuadran ÷ turnos cerrados × 100',
      calculo: sin ? 'No hay turnos cerrados en el mes.' : `${numero(cuadre.turnos_cuadran)} ÷ ${numero(cuadre.turnos_cerrados)} × 100 = ${numero(cuadre.porcentaje, 1)} %`,
      valores: [
        fila('Turnos cerrados en el mes', numero(cuadre.turnos_cerrados)),
        fila('Turnos que cuadraron', numero(cuadre.turnos_cuadran), 'Cerraron con el efectivo exacto'),
        fila('Sobrantes acumulados', bs(cuadre.sobrantes), 'Efectivo de más al cerrar'),
        fila('Faltantes acumulados', bs(cuadre.faltantes), 'Efectivo de menos al cerrar'),
      ],
      resultado: sin ? '—' : `${numero(cuadre.porcentaje, 1)} %`,
      color: sin ? null : cuadre.color,
      semaforo: semaforoMayor(cuadre.umbrales ?? { verde: 95, amarillo: 85 }, '%'),
      extra: {
        titulo: 'Turnos con diferencia',
        filas: (cuadre.turnos_con_diferencia ?? []).slice(0, 6).map((x) => [`${x.turno} · ${x.caja_nombre || x.caja_id}`, `${x.diferencia > 0 ? '+' : '−'}${bs(Math.abs(x.diferencia))} · ${x.tipo}`]),
      },
      decision: 'Revisar los arqueos de los turnos con diferencia y capacitar a los cajeros.',
      pestana: 'cajas',
      pestanaNombre: 'Cajas',
    }
  }

  if (id === 'aceptacion') {
    if (!aceptacion) return null
    const sin = aceptacion.sin_asientos
    const tipos = aceptacion.por_tipo ?? {}
    const nombres = { facturas: 'Facturas', notas_credito: 'Notas de crédito', diferencias_caja: 'Diferencias de caja' }
    return {
      nombre: 'Aceptación contable',
      queMide: AYUDA.aceptacion,
      formula: 'Asientos registrados ÷ asientos enviados × 100',
      calculo: sin ? 'No se enviaron asientos a Contabilidad en el mes.' : `${numero(aceptacion.registrados)} ÷ ${numero(aceptacion.enviados)} × 100 = ${numero(aceptacion.porcentaje, 1)} %`,
      valores: [
        fila('Asientos enviados a Contabilidad', numero(aceptacion.enviados), 'Facturas, notas de crédito y diferencias de caja'),
        fila('Registrados por Contabilidad', numero(aceptacion.registrados)),
        fila('Rechazados', numero(aceptacion.rechazados ?? aceptacion.rechazados_total), 'Se pueden reenviar con una justificación'),
        fila('Sin respuesta todavía', numero(aceptacion.sin_respuesta ?? 0)),
      ],
      resultado: sin ? '—' : `${numero(aceptacion.porcentaje, 1)} %`,
      color: sin ? null : aceptacion.color,
      semaforo: semaforoMayor(aceptacion.umbrales ?? { verde: 98, amarillo: 95 }, '%'),
      extra: {
        titulo: 'Por tipo de asiento',
        filas: Object.entries(tipos).map(([k, v]) => [nombres[k] ?? k, v.disponible === false ? 'No disponible' : `${numero(v.registrados)} registrados de ${numero(v.enviados)} enviados`]),
      },
      aviso: aceptacion.incompleto ? 'Algún tipo de asiento no respondió, así que el porcentaje puede estar incompleto.' : null,
      decision: 'Reenviar los asientos rechazados desde Integraciones, con su justificación.',
      pestana: 'integraciones',
      pestanaNombre: 'Integraciones y proveedores',
    }
  }

  if (id === 'pago_proveedores') {
    if (!dias) return null
    const sin = dias.valor === null || dias.valor === undefined
    return {
      nombre: 'Días promedio de pago a proveedores',
      queMide: AYUDA.pago_proveedores,
      formula: 'Suma de días (aprobación → pago) ÷ órdenes pagadas',
      calculo: sin ? 'Todavía no hay órdenes pagadas en el mes: sin pagos no hay promedio.' : `Promedio de ${numero(dias.ordenes_pagadas_total)} órdenes pagadas = ${numero(dias.valor, 1)} días`,
      valores: [
        fila('Órdenes recibidas en el mes', numero(dias.ordenes_recibidas ?? 0)),
        fila('Órdenes pagadas', numero(dias.ordenes_pagadas_total ?? 0), 'Solo ellas entran al promedio'),
        fila('Órdenes vencidas (sin pagar)', numero(dias.ordenes_vencidas_total ?? 0), `Más de ${dias.dias_para_vencer ?? 15} días desde su aprobación`),
      ],
      resultado: sin ? '—' : `${numero(dias.valor, 1)} días`,
      color: sin ? null : dias.color,
      semaforo: semaforoMenor(dias.umbrales ?? { verde: 7, amarillo: 15 }, 'días'),
      extra: {
        titulo: 'Órdenes vencidas (las más atrasadas)',
        filas: (dias.ordenes_vencidas ?? []).slice(0, 5).map((o) => [`${o.orden} · ${o.proveedor}`, `${numero(o.dias, 0)} días · ${bs(o.monto)}`]),
      },
      decision: 'Priorizar el pago de las órdenes vencidas.',
      pestana: 'integraciones',
      pestanaNombre: 'Integraciones y proveedores',
    }
  }
  return null
}

export { COLOR_NOMBRE }
