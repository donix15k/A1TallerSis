// El PDF del cierre de caja trae la seccion de devoluciones del turno (fecha, productos, monto y como se devolvio) sin romperse en ningun caso.
const test = require("node:test");
const assert = require("node:assert/strict");
const { generarReporteCierrePdfBuffer } = require("../services/reportePdfService");

const base = {
  codigo: "TUR-X", cajaId: "CAJA-02", cajero: "dmntrixc", cerradoPorNombre: "Luis", abiertoEn: "2026-11-23T14:00:00Z", cerradoEn: "2026-11-23T22:00:00Z",
  totalesPorMetodo: { Efectivo: { neto: 100, operaciones: 1 }, Tarjeta: { neto: 0, operaciones: 0 }, QR: { neto: 0, operaciones: 0 } },
  totalRecaudado: 100, resumenVentas: { totalDigital: 0, cantidadVentas: 1, cantidadAnuladas: 0, montoAnulado: 0 }, anuladas: [],
};
const dev = { codigo: "DEV-0001", factura_numero: "F-000021", procesada_en: "2026-11-23T20:10:00Z", monto_total: 52, productos: [{ descripcion: "Aceite Fino", cantidad: 1, subtotal: 15 }], reembolsos: [{ forma: "Tarjeta", monto: 40 }, { forma: "Vale", monto: 12 }] };
const pdf = (devoluciones) => generarReporteCierrePdfBuffer({ ...base, devoluciones }, { cajeroNombre: "dmntrixc" });

test("el PDF se genera con devoluciones, sin devoluciones y si Devoluciones no respondio", async () => {
  const con = await pdf([dev, { ...dev, codigo: "DEV-0002" }]);
  const sin = await pdf([]);
  const caido = await pdf(null);
  for (const b of [con, sin, caido]) assert.equal(b.subarray(0, 4).toString(), "%PDF");
  assert.ok(con.length > sin.length, "con devoluciones el PDF tiene mas contenido");
});

test("muchas devoluciones saltan de hoja sin romperse", async () => {
  const muchas = Array.from({ length: 25 }, (_, i) => ({ ...dev, codigo: `DEV-${i}`, productos: [dev.productos[0], dev.productos[0]] }));
  assert.equal((await pdf(muchas)).subarray(0, 4).toString(), "%PDF");
});
