// TDSI-54/185/682: agrupa los items de venta online por producto (sku), sin contar las
// anuladas, y publica el reporte en "pagos-productos-vendidos" (Pub/Sub simulado).
// BD real; limpia lo que crea.
process.env.COMPRAS_PUBSUB_TOPIC = "projects/proyecto-prueba/topics/pagos-productos-vendidos";

const test = require("node:test");
const assert = require("node:assert/strict");
const { query, pool } = require("../config/db");
const { obtenerProductosVendidos, publicarProductosVendidos } = require("../services/productosVendidosService");
const publisher = require("../clients/pubsubPublisher");

const PREFIJO = `PV-${Date.now()}`;
const FECHA = "2021-10-12";
const OTRO_DIA = "2021-10-13";
const DIA_PUBLICAR = "2021-10-14";

async function venta({ ordenId, dia, estado = "Pagado", hora = "10:00", items }) {
  const { rows } = await query(
    `INSERT INTO pagos.ventas_online (orden_id, cliente_id, total, metodo_pago, estado, codigo_confirmacion, recibida_en)
     VALUES ($1, 'Cliente', $2, 'QR', $3, 'CNF-TEST', ($4 || ' ' || $5)::timestamp AT TIME ZONE 'America/La_Paz')
     RETURNING id`,
    [ordenId, items.reduce((acc, it) => acc + it.cantidad * it.precioUnitario, 0), estado, dia, hora]
  );
  const ventaId = rows[0].id;
  for (const it of items) {
    await query(
      `INSERT INTO pagos.venta_online_items (venta_id, sku, descripcion, cantidad, precio_unitario, subtotal)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ventaId, it.sku, it.descripcion, it.cantidad, it.precioUnitario, it.cantidad * it.precioUnitario]
    );
  }
  return ventaId;
}

test.after(async () => {
  publisher.usarClienteDePrueba(null);
  await query(`DELETE FROM pagos.ventas_online WHERE orden_id LIKE $1`, [`${PREFIJO}%`]);
  // TDSI-964: cada publicarProductosVendidos() tambien queda en el log compartido de
  // "Verificación de Pub/Sub".
  await query(`DELETE FROM pagos.pubsub_verificaciones WHERE payload_enviado->>'referencia_externa' = $1`, [`PV-${DIA_PUBLICAR}`]);
  await query(`DELETE FROM pagos.envios_compras WHERE fecha = $1`, [DIA_PUBLICAR]);
  await pool.end();
});

test("TDSI-185: agrupa por sku, suma cantidad y monto, y ordena de mas a menos vendido", async () => {
  await venta({
    ordenId: `${PREFIJO}-1`, dia: FECHA, hora: "09:00",
    items: [{ sku: "ARR-01", descripcion: "Arroz 1kg", cantidad: 2, precioUnitario: 10 }, { sku: "ACE-02", descripcion: "Aceite 900ml", cantidad: 1, precioUnitario: 15 }],
  });
  await venta({
    ordenId: `${PREFIJO}-2`, dia: FECHA, hora: "14:00",
    items: [{ sku: "ARR-01", descripcion: "Arroz 1kg", cantidad: 5, precioUnitario: 10 }],
  });

  const r = await obtenerProductosVendidos(FECHA);
  const propios = r.productos.filter((p) => ["ARR-01", "ACE-02"].includes(p.sku));
  assert.deepEqual(propios, [
    { sku: "ARR-01", descripcion: "Arroz 1kg", cantidad: 7, monto: 70 },
    { sku: "ACE-02", descripcion: "Aceite 900ml", cantidad: 1, monto: 15 },
  ]);
});

test("TDSI-185: no cuenta las ventas anuladas", async () => {
  await venta({
    ordenId: `${PREFIJO}-3`, dia: FECHA, hora: "16:00", estado: "Anulado",
    items: [{ sku: "LEC-03", descripcion: "Leche 1L", cantidad: 10, precioUnitario: 7 }],
  });

  const r = await obtenerProductosVendidos(FECHA);
  assert.equal(r.productos.some((p) => p.sku === "LEC-03"), false);
});

test("TDSI-185: no mezcla ventas de otro dia", async () => {
  await venta({
    ordenId: `${PREFIJO}-4`, dia: OTRO_DIA, hora: "10:00",
    items: [{ sku: "QUE-04", descripcion: "Queso 500g", cantidad: 3, precioUnitario: 20 }],
  });

  const delDia = await obtenerProductosVendidos(FECHA);
  assert.equal(delDia.productos.some((p) => p.sku === "QUE-04"), false);

  const delOtroDia = await obtenerProductosVendidos(OTRO_DIA);
  assert.deepEqual(delOtroDia.productos.find((p) => p.sku === "QUE-04"), { sku: "QUE-04", descripcion: "Queso 500g", cantidad: 3, monto: 60 });
});

test("TDSI-185: un dia sin ventas trae la lista vacia (no es un error)", async () => {
  const r = await obtenerProductosVendidos("2021-01-01");
  assert.deepEqual(r, { fecha: "2021-01-01", productos: [] });
});

test("TDSI-185: exige la fecha y valida que sea una fecha real", async () => {
  await assert.rejects(() => obtenerProductosVendidos(), (e) => e.status === 400);
  await assert.rejects(() => obtenerProductosVendidos("no-es-fecha"), (e) => e.status === 400);
});

test("TDSI-682/964: publica el reporte en el sobre estandar, con un identificador unico por fecha, y queda en el log compartido", async () => {
  await venta({
    ordenId: `${PREFIJO}-5`, dia: DIA_PUBLICAR, hora: "11:00",
    items: [{ sku: "PAN-05", descripcion: "Pan de molde", cantidad: 4, precioUnitario: 8 }],
  });
  const publicados = [];
  publisher.usarClienteDePrueba({ topic: () => ({ publishMessage: async (msg) => { publicados.push(msg); return "pub-1"; } }) });

  const { mensaje, resultado, envio } = await publicarProductosVendidos(DIA_PUBLICAR);

  // TDSI-964: mismo sobre que Contabilidad/Marketplace/"Verificación de Pub/Sub".
  assert.equal(mensaje.sistema_origen, "GESTION_DE_PAGOS_Y_FACTURACION");
  assert.equal(mensaje.referencia_externa, `PV-${DIA_PUBLICAR}`);
  assert.equal(mensaje.tipo_operacion, "productos_vendidos");
  assert.equal(mensaje.fecha_documento, DIA_PUBLICAR);
  assert.ok(mensaje.datos.productos.some((p) => p.sku === "PAN-05"));
  assert.ok(mensaje.datos.generado_en);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.messageId, "pub-1");

  const ultimo = publicados.at(-1);
  assert.equal(ultimo.attributes.grupo, "A");
  assert.deepEqual(ultimo.json, mensaje);

  // TDSI-697: el intento quedo registrado en pagos.envios_compras.
  assert.equal(envio.estado, "Enviado");
  assert.equal(envio.pubsub_message_id, "pub-1");
  assert.equal(envio.reporte_id, `PV-${DIA_PUBLICAR}`);

  // TDSI-964: y en el log compartido de "Verificación de Pub/Sub" con destino fijo (C = Compras).
  const { rows: log } = await query(
    `SELECT grupo, grupo_origen, ok FROM pagos.pubsub_verificaciones WHERE payload_enviado->>'referencia_externa' = $1 ORDER BY creado_en DESC LIMIT 1`,
    [`PV-${DIA_PUBLICAR}`]
  );
  assert.deepEqual(log[0], { grupo: "C", grupo_origen: "A", ok: true });
});

test("TDSI-964: se puede simular que el reporte viene de otro grupo (grupoOrigen), sin cambiar el destino (Compras)", async () => {
  publisher.usarClienteDePrueba({ topic: () => ({ publishMessage: async () => "pub-origen" }) });
  const { mensaje } = await publicarProductosVendidos(DIA_PUBLICAR, { grupoOrigen: "i", enviadoPor: "admin-test@correo.test" });
  assert.equal(mensaje.sistema_origen, "GESTION_DE_INVENTARIOS_Y_ALMACEN");

  const { rows: log } = await query(
    `SELECT grupo, grupo_origen, enviado_por FROM pagos.pubsub_verificaciones WHERE payload_enviado->>'referencia_externa' = $1 ORDER BY creado_en DESC LIMIT 1`,
    [`PV-${DIA_PUBLICAR}`]
  );
  assert.deepEqual(log[0], { grupo: "C", grupo_origen: "I", enviado_por: "admin-test@correo.test" });
});

test("TDSI-964: un grupoOrigen invalido responde 400", async () => {
  await assert.rejects(() => publicarProductosVendidos(DIA_PUBLICAR, { grupoOrigen: "Z" }), (e) => e.status === 400);
});

test("TDSI-682: el mismo identificador siempre sale igual para la misma fecha (lo que publica Compras puede deduplicar)", async () => {
  publisher.usarClienteDePrueba({ topic: () => ({ publishMessage: async () => "pub-2" }) });
  const { mensaje: m1 } = await publicarProductosVendidos(DIA_PUBLICAR);
  const { mensaje: m2 } = await publicarProductosVendidos(DIA_PUBLICAR);
  assert.equal(m1.referencia_externa, m2.referencia_externa);
});

test("TDSI-682: si no hubo ventas ese dia, no se puede enviar", async () => {
  await assert.rejects(() => publicarProductosVendidos("2021-01-02"), (e) => e.status === 409);
});

test("TDSI-682: si Pub/Sub no responde, se informa el error (no lanza) y queda Error en envios_compras", async () => {
  publisher.usarClienteDePrueba({ topic: () => ({ publishMessage: async () => { throw new Error("el topico no existe"); } }) });
  const { resultado, envio } = await publicarProductosVendidos(DIA_PUBLICAR);
  assert.equal(resultado.ok, false);
  assert.equal(envio.estado, "Error");
  assert.match(envio.ultimo_error, /el topico no existe/);
  assert.match(resultado.error, /el topico no existe/);
});
