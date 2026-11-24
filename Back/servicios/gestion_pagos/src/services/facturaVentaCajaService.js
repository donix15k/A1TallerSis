// Cada venta de caja emite tambien su factura OFICIAL en Facturacion (F-NNNNNN), copiando lo que ya hace una venta del Marketplace
// (ventaOnlineService.js): Facturacion es el dueño de la numeracion, publica el asiento a Contabilidad por Pub/Sub y Devoluciones lee de ahi.
// Si Facturacion no responde, la venta NO se pierde: queda guardado el error en la propia venta (como con el Marketplace).
const repo = require("../data/pagosRepo");
const { emitirFacturaCaja } = require("./facturacionCajaProxy");

// El NIT que acepta Facturacion tiene entre 6 y 15 digitos: una venta "sin datos" se factura a nombre de "Consumidor final" con el NIT generico.
const NIT_SIN_DATOS = "0000000";
const RAZON_SIN_DATOS = "Consumidor final";

// Pruebas: no se emiten facturas reales (publicarian a Contabilidad) salvo que la prueba pida un emisor falso.
let emisorPrueba;
function usarEmisorDePrueba(falso) {
  emisorPrueba = falso;
}
const omitir = () => emisorPrueba === undefined && Boolean(process.env.NODE_TEST_CONTEXT) && process.env.EMITIR_FACTURA_CAJA_EN_PRUEBAS !== "1";

/**
 * Emite la factura de una venta de caja ya registrada. `metodos`: [{ metodo, monto }] (uno si es simple, dos si es mixto); `lineas`: los productos
 * de la tiendita (o null si se cobro solo por monto: va una sola linea "Venta"). Nunca lanza: devuelve { numero_factura } o { factura_error }.
 */
async function emitirFacturaDeVenta({ id_transaccion, monto, nit, razon_social, metodos, lineas }) {
  if (omitir()) return { omitida: true };
  const emitir = emisorPrueba || emitirFacturaCaja;
  const items = lineas
    ? lineas.map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: l.precio_unitario }))
    : [{ descripcion: "Venta", cantidad: 1, precio_unitario: Number(monto) }];
  try {
    const datos = {
      nit: nit || NIT_SIN_DATOS,
      razon_social: razon_social || RAZON_SIN_DATOS,
      items,
      canal: "Presencial",
    };
    if (metodos.length > 1) datos.metodos_pago = metodos.map((m) => ({ metodo: m.metodo, monto: m.monto }));
    else datos.metodo_pago = metodos[0].metodo;
    const factura = await emitir(datos);
    await repo.guardarFacturaDeVenta(id_transaccion, { numero_factura: factura.numero });
    return { numero_factura: factura.numero };
  } catch (e) {
    await repo.guardarFacturaDeVenta(id_transaccion, { factura_error: e.message }).catch(() => {});
    console.error(`[factura caja] ${id_transaccion}: ${e.message}`);
    return { factura_error: e.message };
  }
}

module.exports = { emitirFacturaDeVenta, usarEmisorDePrueba, NIT_SIN_DATOS, RAZON_SIN_DATOS };
