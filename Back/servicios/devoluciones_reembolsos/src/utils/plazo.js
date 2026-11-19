// Plazo para devolver: 7 dias CALENDARIO desde la fecha de la factura, contados con la hora de Bolivia
// (America/La_Paz, UTC-4, sin horario de verano). Una factura del 10/11 se puede devolver hasta el
// 17/11 inclusive, a cualquier hora; el 18/11 ya esta fuera de plazo.
const ZONA = "America/La_Paz";
const MS_POR_DIA = 24 * 60 * 60 * 1000;

const PLAZO_POR_DEFECTO = () => Number(process.env.PLAZO_DEVOLUCION_DIAS) || 7;

/** Fecha calendario en Bolivia como "YYYY-MM-DD". */
function fechaEnBolivia(fecha) {
  return new Date(fecha).toLocaleDateString("en-CA", { timeZone: ZONA });
}

/** "YYYY-MM-DD" -> milisegundos UTC de ese dia a medianoche (solo para restar fechas de calendario). */
const aUtc = (fechaIso) => {
  const [y, m, d] = fechaIso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Dias de calendario entre dos fechas "YYYY-MM-DD" (b - a). */
const diasEntre = (a, b) => Math.round((aUtc(b) - aUtc(a)) / MS_POR_DIA);

function sumarDias(fechaIso, dias) {
  const [y, m, d] = fechaIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * TDSI-12: ¿la factura esta dentro del plazo de devolucion?
 *   estaDentroDePlazo(fechaFactura, ahora = new Date(), diasLimite = 7)
 * Devuelve { dentro_de_plazo, dias_transcurridos, dias_limite, fecha_factura, fecha_limite }.
 */
function estaDentroDePlazo(fechaFactura, ahora = new Date(), diasLimite = PLAZO_POR_DEFECTO()) {
  const fechaFacturaBo = fechaEnBolivia(fechaFactura);
  const hoyBo = fechaEnBolivia(ahora);
  const diasTranscurridos = diasEntre(fechaFacturaBo, hoyBo);
  return {
    dentro_de_plazo: diasTranscurridos <= diasLimite,
    dias_transcurridos: diasTranscurridos,
    dias_limite: diasLimite,
    fecha_factura: fechaFacturaBo,
    fecha_limite: sumarDias(fechaFacturaBo, diasLimite),
  };
}

module.exports = { estaDentroDePlazo, fechaEnBolivia };
