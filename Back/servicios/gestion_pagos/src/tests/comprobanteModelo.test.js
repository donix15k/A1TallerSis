const test = require("node:test");
const assert = require("node:assert/strict");
const { construirModeloComprobante, formatearFechaHora } = require("../services/comprobanteModelo");

const EMPRESA = { nombre: "Vortrix", direccion: "Av. Principal s/n, Bolivia", nit: "1009876015" };

function facturaBase(extra = {}) {
  return {
    empresa: EMPRESA,
    comprobante: {
      id_transaccion: "VTA-000001",
      fecha: "2026-11-08T01:34:10Z",
      caja_id: "CAJA-01",
      cajero_nombre: "Rodny",
      tipo_pago: "Simple",
      anulada: false,
      ...extra.comprobante,
    },
    cliente: { nit: "1234567", razon_social: "Cliente Prueba", ...extra.cliente },
    pagos: [{ metodo: "Efectivo", monto: 25, moneda_recibida: null }],
    total: 25,
    ...extra.raiz,
  };
}

test("la fecha y la hora salen en horario de Bolivia, sin '24:' a medianoche", () => {
  assert.deepEqual(formatearFechaHora("2026-11-08T01:34:10Z"), { dia: "07/11/2026", hora: "21:34:10" });
  assert.equal(formatearFechaHora("2026-10-12T04:31:27Z").hora, "00:31:27");
});

test("comprobante simple: titulo, datos, detalle por metodo de pago y total", () => {
  const m = construirModeloComprobante(facturaBase());
  assert.equal(m.titulo, "COMPROBANTE DE PAGO");
  assert.equal(m.puntoVenta, "Punto de venta: CAJA-01");
  assert.deepEqual(m.datos[0], ["N° de comprobante:", "VTA-000001"]);
  assert.deepEqual(m.detalle.encabezado, ["Método de pago", "Monto Bs."]);
  assert.deepEqual(m.detalle.filas, [["Efectivo", "25.00"]]);
  assert.equal(m.total, "25.00");
  assert.match(m.son, /^Son: VEINTICINCO|^Son: VEINTEICINCO/);
  assert.equal(m.anulada, false);
});

test("pago mixto, pago en dolares y anulada", () => {
  const m = construirModeloComprobante(
    facturaBase({
      comprobante: { tipo_pago: "Mixto", anulada: true },
      raiz: {
        pagos: [
          { metodo: "Efectivo", monto: 10, moneda_recibida: "USD", monto_usd: 1.44, tipo_cambio: 6.96 },
          { metodo: "Tarjeta", monto: 15, moneda_recibida: null },
        ],
      },
    })
  );
  assert.equal(m.titulo, "COMPROBANTE DE PAGO MIXTO");
  assert.equal(m.anulada, true);
  assert.equal(m.detalle.filas[0][0], "Efectivo (Pagado en USD: 1.44 USD, T.C. 6.96)");
  assert.equal(m.detalle.filas.length, 2);
});

test("venta online: usa el detalle de items y muestra la orden en vez del cajero", () => {
  const m = construirModeloComprobante({
    empresa: EMPRESA,
    comprobante: { id_transaccion: "F-000012", orden_id: "ORD-1", fecha: "2026-11-10T20:37:23Z", canal: "Marketplace", caja_id: null },
    cliente: { nit: null, razon_social: "Cliente" },
    items: [{ descripcion: "Producto", cantidad: 2, subtotal: 20 }],
    total: 20,
  });
  assert.equal(m.titulo, "COMPROBANTE DE VENTA ONLINE");
  assert.equal(m.atendidoPor, "Orden: ORD-1");
  assert.equal(m.puntoVenta, null);
  assert.deepEqual(m.detalle.encabezado, ["Producto", "Subtotal Bs."]);
  assert.deepEqual(m.detalle.filas, [["Producto x2", "20.00"]]);
  assert.equal(m.cliente.length, 1); // sin NIT no hay fila de NIT/CI
});
