// Toda factura nueva lleva su metodo de pago (Efectivo, Tarjeta o QR). Base real (servicio, sin pasar por la
// ruta HTTP: esa publica a Contabilidad por Pub/Sub). Las facturas y el cliente de prueba se borran al final.
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearFactura } = require("../services/facturasService");
const { obtenerFactura } = require("../services/tirillaService");
const { query, pool } = require("../config/db");

const NIT = `8${String(Date.now()).slice(-8)}`;
const creadas = [];
const ITEMS = [
  { descripcion: "Producto A", cantidad: 2, precio_unitario: 10 },
  { descripcion: "Producto B", cantidad: 1, precio_unitario: 28 },
]; // total 48

const emitir = async (extra) => {
  const f = await crearFactura({ nit: NIT, razon_social: "Cliente Metodo Pago", items: ITEMS, ...extra });
  creadas.push(f.id);
  return f;
};

const metodosEnBase = async (facturaId) =>
  (await query(`SELECT metodo, monto FROM facturacion.factura_metodos_pago WHERE factura_id = $1 ORDER BY id`, [facturaId])).rows.map((r) => [r.metodo, Number(r.monto)]);

test.after(async () => {
  if (creadas.length) await query(`DELETE FROM facturacion.facturas WHERE id = ANY($1)`, [creadas]);
  await query(`DELETE FROM facturacion.clientes_frecuentes WHERE nit = $1`, [NIT]);
  await pool.end();
});

test("con metodo_pago la factura queda con ese metodo por el total", async () => {
  const f = await emitir({ metodo_pago: "QR" });
  assert.deepEqual(await metodosEnBase(f.id), [["QR", 48]]);
  assert.deepEqual(f.metodosPago, [{ metodo: "QR", monto: 48 }]);
});

test("la consulta de la factura (GET /api/facturas/:numero) trae el metodo de pago", async () => {
  const f = await emitir({ metodo_pago: "Tarjeta" });
  const completa = await obtenerFactura(f.numero);
  assert.deepEqual(completa.metodosPago.map((m) => [m.metodo, Number(m.monto)]), [["Tarjeta", 48]]);
});

test("el metodo no distingue mayusculas ni espacios: ' efectivo ' -> Efectivo, 'qr' -> QR", async () => {
  assert.deepEqual(await metodosEnBase((await emitir({ metodo_pago: " efectivo " })).id), [["Efectivo", 48]]);
  assert.deepEqual(await metodosEnBase((await emitir({ metodo_pago: "qr" })).id), [["QR", 48]]);
});

test("pago mixto: cada metodo con su monto, y suman el total", async () => {
  const f = await emitir({ metodos_pago: [{ metodo: "Efectivo", monto: 20 }, { metodo: "qr", monto: 28 }] });
  assert.deepEqual(await metodosEnBase(f.id), [["Efectivo", 20], ["QR", 28]]);
});

test("sin metodo de pago: error 400 y NO se guarda nada (ni factura ni cliente)", async () => {
  const clientesAntes = (await query(`SELECT count(*)::int n FROM facturacion.clientes_frecuentes WHERE nit = $1`, [NIT])).rows[0].n;
  const facturasAntes = (await query(`SELECT count(*)::int n FROM facturacion.facturas`)).rows[0].n;
  const NIT_NUEVO = `7${String(Date.now()).slice(-8)}`;
  for (const extra of [{}, { metodo_pago: "" }, { metodo_pago: "   " }, { metodo_pago: null }, { metodos_pago: [] }]) {
    await assert.rejects(
      crearFactura({ nit: NIT_NUEVO, razon_social: "No debe guardarse", items: ITEMS, ...extra }),
      (e) => e.status === 400 && /metodo de pago/.test(e.message),
      `deberia rechazar ${JSON.stringify(extra)}`
    );
  }
  assert.equal((await query(`SELECT count(*)::int n FROM facturacion.facturas`)).rows[0].n, facturasAntes);
  assert.equal((await query(`SELECT count(*)::int n FROM facturacion.clientes_frecuentes WHERE nit = $1`, [NIT_NUEVO])).rows[0].n, 0, "el cliente no debe quedar guardado");
  assert.equal((await query(`SELECT count(*)::int n FROM facturacion.clientes_frecuentes WHERE nit = $1`, [NIT])).rows[0].n, clientesAntes);
});

test("metodo desconocido: 400 con los permitidos", async () => {
  for (const metodo of ["Transferencia", "cheque", "Efectivo QR"]) {
    await assert.rejects(
      crearFactura({ nit: NIT, razon_social: "Cliente Metodo Pago", items: ITEMS, metodo_pago: metodo }),
      (e) => e.status === 400 && /Efectivo, Tarjeta, QR/.test(e.message),
      metodo
    );
  }
});

test("pago mixto invalido: montos que no suman el total, en cero, negativos o metodo repetido", async () => {
  const malo = async (metodos_pago, patron) =>
    assert.rejects(
      crearFactura({ nit: NIT, razon_social: "Cliente Metodo Pago", items: ITEMS, metodos_pago }),
      (e) => e.status === 400 && patron.test(e.message),
      JSON.stringify(metodos_pago)
    );
  await malo([{ metodo: "Efectivo", monto: 20 }, { metodo: "QR", monto: 20 }], /deben sumar el total/); // 40 != 48
  await malo([{ metodo: "Efectivo", monto: 50 }], /deben sumar el total/); // 50 != 48
  await malo([{ metodo: "Efectivo", monto: 48 }, { metodo: "QR", monto: 0 }], /monto mayor a 0/);
  await malo([{ metodo: "Efectivo", monto: 58 }, { metodo: "QR", monto: -10 }], /monto mayor a 0/);
  await malo([{ metodo: "Efectivo", monto: 24 }, { metodo: "efectivo", monto: 24 }], /repetido/);
  await malo([{ metodo: "Efectivo", monto: "abc" }], /monto mayor a 0/);
});

test("el centavo no rompe la suma: total con decimales y pago mixto", async () => {
  const f = await crearFactura({
    nit: NIT, razon_social: "Cliente Metodo Pago",
    items: [{ descripcion: "Producto", cantidad: 3, precio_unitario: 3.33 }], // 9.99
    metodos_pago: [{ metodo: "Efectivo", monto: 5 }, { metodo: "QR", monto: 4.99 }],
  });
  creadas.push(f.id);
  assert.deepEqual(await metodosEnBase(f.id), [["Efectivo", 5], ["QR", 4.99]]);
});

test("si algo falla al guardar la factura no queda nada a medias (ni factura ni metodo huerfano)", async () => {
  const NIT_FALLA = `6${String(Date.now()).slice(-8)}`;
  try {
    // una descripcion de mas de 200 caracteres no cabe en factura_items.descripcion: falla DESPUES de insertar la factura
    await assert.rejects(crearFactura({
      nit: NIT_FALLA, razon_social: "Cliente que falla",
      items: [{ descripcion: "X".repeat(250), cantidad: 1, precio_unitario: 10 }],
      metodo_pago: "Efectivo",
    }));
    const { rows } = await query(
      `SELECT count(*)::int AS facturas,
              (SELECT count(*)::int FROM facturacion.factura_metodos_pago m JOIN facturacion.facturas f2 ON f2.id = m.factura_id WHERE f2.cliente_nit = $1) AS metodos
         FROM facturacion.facturas WHERE cliente_nit = $1`,
      [NIT_FALLA]
    );
    assert.deepEqual(rows[0], { facturas: 0, metodos: 0 });
  } finally {
    await query(`DELETE FROM facturacion.clientes_frecuentes WHERE nit = $1`, [NIT_FALLA]);
  }
});
