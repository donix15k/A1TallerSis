// Como se devuelve el dinero segun como pago el cliente (clase Reembolso del diagrama UML).
const TIPO_POR_METODO = {
  Efectivo: "EFECTIVO",
  Tarjeta: "REVERSION_TARJETA",
  QR: "REVERSION_QR",
  Vale: "VALE", // una venta pagada con vale se devuelve en un vale nuevo (TDSI-70)
};

const METODO_POR_TIPO = Object.fromEntries(Object.entries(TIPO_POR_METODO).map(([metodo, tipo]) => [tipo, metodo]));

const redondear = (n) => Math.round(Number((n * 100).toPrecision(12))) / 100;

/** Efectivo -> EFECTIVO, Tarjeta -> REVERSION_TARJETA, QR -> REVERSION_QR. null si el metodo no es ninguno de esos. */
function tipoDeReembolso(metodo) {
  return TIPO_POR_METODO[metodo] ?? null;
}

/**
 * Reparte `monto` entre los metodos con que se pago la factura, en proporcion a lo que se pago con cada uno
 * (una factura pagada 20 en efectivo y 80 por QR, con 45 a devolver -> 9 en efectivo y 36 por QR).
 * Los centavos que sobran por el redondeo van al ultimo metodo, asi la suma da SIEMPRE el monto exacto.
 *   metodos: [{ metodo, monto }]  ->  [{ metodo, monto }]
 */
function repartirMonto(monto, metodos) {
  const total = redondear(metodos.reduce((acc, m) => acc + m.monto, 0));
  let acumulado = 0;
  return metodos.map((m, i) => {
    const esUltimo = i === metodos.length - 1;
    const parte = esUltimo ? redondear(monto - acumulado) : redondear((monto * m.monto) / total);
    acumulado = redondear(acumulado + parte);
    return { metodo: m.metodo, monto: parte };
  });
}

module.exports = { TIPO_POR_METODO, METODO_POR_TIPO, tipoDeReembolso, repartirMonto, redondear };
