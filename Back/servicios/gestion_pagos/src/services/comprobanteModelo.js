const { montoEnLetras } = require("../utils/numeroALetras");
const { lineaAtendidoPor } = require("../utils/atendidoPor");

/**
 * Modelo unico del comprobante: de aqui salen, con exactamente el mismo texto, el PDF
 * (facturaPdfService.js) y la vista previa animada del Frontend (endpoint
 * GET /api/pagos/:id/comprobante). Asi lo que el cajero ve al "imprimirse" en pantalla
 * es lo mismo que despues se descarga o llega por correo.
 */

function formatearFechaHora(fechaIso) {
  const fecha = new Date(fechaIso);
  const dia = fecha.toLocaleDateString("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = fecha.toLocaleTimeString("es-BO", { timeZone: "America/La_Paz", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  return { dia, hora };
}

function tituloComprobante(comprobante) {
  if (comprobante.canal === "Marketplace") return "COMPROBANTE DE VENTA ONLINE";
  return comprobante.tipo_pago === "Mixto" ? "COMPROBANTE DE PAGO MIXTO" : "COMPROBANTE DE PAGO";
}

function construirModeloComprobante(factura) {
  const { comprobante, cliente, empresa } = factura;
  const { dia, hora } = formatearFechaHora(comprobante.fecha);
  const esOnline = comprobante.canal === "Marketplace";

  // TDSI-51: una venta de Marketplace es un solo pago -- se muestra el detalle de items
  // de la orden en vez del desglose por metodo de pago.
  const detalle = Array.isArray(factura.items)
    ? {
        encabezado: ["Producto", "Subtotal Bs."],
        filas: factura.items.map((it) => [`${it.descripcion} x${it.cantidad}`, it.subtotal.toFixed(2)]),
      }
    : {
        encabezado: ["Método de pago", "Monto Bs."],
        filas: factura.pagos.map((p) => {
          let etiqueta = p.metodo;
          if (p.metodo === "Efectivo" && p.moneda_recibida === "USD") {
            etiqueta += ` (Pagado en USD: ${Number(p.monto_usd).toFixed(2)} USD, T.C. ${p.tipo_cambio})`;
          }
          return [etiqueta, p.monto.toFixed(2)];
        }),
      };

  // Productos de la venta de caja: una tabla "Producto / Subtotal" ANTES del desglose por metodo de pago.
  const productos = Array.isArray(factura.productos) && factura.productos.length
    ? {
        encabezado: ["Producto", "Subtotal Bs."],
        filas: factura.productos.map((p) => [`${p.cantidad} x ${p.descripcion} (Bs ${Number(p.precio_unitario).toFixed(2)})`, Number(p.subtotal).toFixed(2)]),
      }
    : null;

  // Quien autorizo algo en esta venta (anulacion o modificacion de datos): el supervisor de caja.
  const aut = factura.autorizaciones || {};
  const autorizacion = [];
  if (aut.anulacion) {
    autorizacion.push(["Anulada con autorización de:", aut.anulacion.supervisor || "no registrado"]);
    if (aut.anulacion.fecha) {
      const f = formatearFechaHora(aut.anulacion.fecha);
      autorizacion.push(["Fecha de anulación:", `${f.dia} ${f.hora}`]);
    }
    if (aut.anulacion.motivo) autorizacion.push(["Motivo:", aut.anulacion.motivo]);
  }
  if (Array.isArray(aut.modificacion) && aut.modificacion.length) {
    autorizacion.push(["Datos modificados con autorización de:", aut.modificacion.join(", ")]);
  }

  const datos = [
    ["N° de comprobante:", comprobante.id_transaccion],
    ["Fecha:", dia],
    ["Hora de emisión:", hora],
  ];

  const clienteFilas = [["Nombre/Razón social:", cliente.razon_social]];
  if (cliente.nit) clienteFilas.push(["NIT/CI:", cliente.nit]);

  return {
    empresa: { nombre: empresa.nombre, direccion: empresa.direccion, nit: empresa.nit },
    puntoVenta: comprobante.caja_id ? `Punto de venta: ${comprobante.caja_id}` : null,
    titulo: tituloComprobante(comprobante),
    anulada: Boolean(comprobante.anulada),
    datos,
    // TDSI-61/944: si se reimprime, siguen siendo los datos de quien la emitio originalmente.
    // TDSI-51: una venta de Marketplace no tiene cajero/caja -- se muestra su N° de orden.
    atendidoPor: esOnline ? `Orden: ${comprobante.orden_id}` : lineaAtendidoPor(comprobante),
    cliente: clienteFilas,
    productos,
    detalle,
    autorizacion,
    total: factura.total.toFixed(2),
    son: `Son: ${montoEnLetras(factura.total)}`,
    qrTexto: "Escanee el código QR para verificar esta factura",
    pie: [
      "Documento generado por el sistema Vortrix.",
      "Uso académico - Taller de Sistemas de Información.",
    ],
    gracias: "¡Gracias por su compra!",
  };
}

module.exports = { construirModeloComprobante, formatearFechaHora, tituloComprobante };
