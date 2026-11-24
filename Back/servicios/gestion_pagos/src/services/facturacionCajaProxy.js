// Copia del proxy que usa el Marketplace para emitir su factura (facturacionProxy.js), pero para las ventas de CAJA: ademas manda
// metodos_pago cuando la venta es de pago mixto. Es un archivo aparte a proposito: el del Marketplace no se toca.
const FACTURACION_URL = process.env.FACTURACION_URL || "http://localhost:4002";

/** Devuelve la factura creada ({ numero, id, ... }); lanza un Error con un mensaje claro si falla. */
async function emitirFacturaCaja({ nit, razon_social, items, metodo_pago, metodos_pago, canal }) {
  let respuesta;
  try {
    respuesta = await fetch(`${FACTURACION_URL}/api/facturas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nit, razon_social, items, metodo_pago, metodos_pago, canal }),
    });
  } catch (e) {
    throw new Error("No se pudo contactar a facturacion para emitir la factura.");
  }
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) throw new Error(datos?.mensaje || "facturacion no pudo emitir la factura.");
  return datos.data;
}

module.exports = { emitirFacturaCaja };
