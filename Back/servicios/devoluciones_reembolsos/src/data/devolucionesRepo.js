const { query, withTransaction } = require("../config/db");
const { AppError } = require("../utils/AppError");

/** TDSI-20: motivos que el cajero puede elegir (solo los activos, en el orden del catalogo). */
async function listarMotivosActivos() {
  const { rows } = await query(`SELECT id, nombre FROM devoluciones.motivos WHERE activo ORDER BY id`);
  return rows.map((r) => ({ id: Number(r.id), nombre: r.nombre }));
}

/** TDSI-21: el motivo elegido, solo si existe y sigue activo (null si no). */
async function obtenerMotivoActivo(id) {
  const { rows } = await query(`SELECT id, nombre FROM devoluciones.motivos WHERE id = $1 AND activo`, [id]);
  return rows[0] ? { id: Number(rows[0].id), nombre: rows[0].nombre } : null;
}

/**
 * TDSI-12: lo que YA se devolvio de una factura, sumado por producto (descripcion + precio unitario,
 * que es lo que identifica una linea de la factura en Facturacion). Cuentan las devoluciones que
 * reservan mercaderia: PENDIENTE, APROBADA y PROCESADA. Una RECHAZADA no devolvio nada, asi que no descuenta.
 */
async function cantidadesYaDevueltas(facturaNumero) {
  const { rows } = await query(
    `SELECT i.descripcion, i.precio_unitario, SUM(i.cantidad) AS cantidad
       FROM devoluciones.devolucion_items i
       JOIN devoluciones.devoluciones d ON d.id = i.devolucion_id
      WHERE d.factura_numero = $1
        AND d.estado IN ('PENDIENTE', 'APROBADA', 'PROCESADA')
      GROUP BY i.descripcion, i.precio_unitario`,
    [facturaNumero]
  );
  return rows.map((r) => ({
    descripcion: r.descripcion,
    precio_unitario: Number(r.precio_unitario),
    cantidad: Number(r.cantidad),
  }));
}

const claveProducto = (descripcion, precio) => `${String(descripcion).trim().toLowerCase()}|${Number(precio).toFixed(2)}`;

/**
 * TDSI-22: guarda la devolucion en estado PENDIENTE junto con sus items, en UNA sola transaccion: o se
 * guarda todo o no se guarda nada (y el codigo no se "gasta").
 *  - Codigo correlativo DEV-0001, DEV-0002, ...: el siguiente numero se calcula con un candado de la base
 *    (advisory lock), asi dos devoluciones simultaneas nunca reciben el mismo codigo.
 *  - Antes de guardar se vuelve a comprobar la cantidad disponible DENTRO de la transaccion y con un candado
 *    por factura: si dos cajeros devuelven lo mismo a la vez, el segundo recibe 409 en vez de devolver de mas.
 */
async function crearDevolucion({ factura, comprados, tipo, monto_total, motivo_id, observaciones, items, cajero }) {
  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`devoluciones.factura.${factura.numero}`]);

    // 1) disponible real, ya con el candado: lo devuelto por otras solicitudes en el ultimo instante cuenta.
    const { rows: ya } = await client.query(
      `SELECT i.descripcion, i.precio_unitario, SUM(i.cantidad) AS cantidad
         FROM devoluciones.devolucion_items i
         JOIN devoluciones.devoluciones d ON d.id = i.devolucion_id
        WHERE d.factura_numero = $1 AND d.estado IN ('PENDIENTE', 'APROBADA', 'PROCESADA')
        GROUP BY i.descripcion, i.precio_unitario`,
      [factura.numero]
    );
    const yaDevuelto = new Map(ya.map((r) => [claveProducto(r.descripcion, r.precio_unitario), Number(r.cantidad)]));
    const compradoPorProducto = new Map(comprados.map((c) => [claveProducto(c.descripcion, c.precio_unitario), c.comprada]));
    for (const it of items) {
      const k = claveProducto(it.descripcion, it.precio_unitario);
      const disponible = Math.round(((compradoPorProducto.get(k) ?? 0) - (yaDevuelto.get(k) ?? 0)) * 100) / 100;
      if (it.cantidad > disponible) {
        throw new AppError(
          `Otra devolución de esta factura se registró mientras tanto: de "${it.descripcion}" solo quedan ${Math.max(disponible, 0)} disponibles.`,
          409,
          { descripcion: it.descripcion, disponible: Math.max(disponible, 0) }
        );
      }
    }

    // 2) codigo correlativo (se toma el mayor DEV-NNNN que exista, ignorando otros formatos de codigo)
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('devoluciones.codigo'))`);
    const { rows: sig } = await client.query(
      `SELECT COALESCE(MAX(substring(codigo from '^DEV-(\\d+)$')::int), 0) + 1 AS siguiente FROM devoluciones.devoluciones`
    );
    const codigo = `DEV-${String(sig[0].siguiente).padStart(4, "0")}`;

    // 3) cabecera + items
    const { rows } = await client.query(
      `INSERT INTO devoluciones.devoluciones
         (codigo, factura_numero, cliente_nit, fecha_venta, dentro_de_plazo, tipo, motivo_id, observaciones,
          metodo_pago_original, monto_total, estado, creado_por)
       VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8, $9, 'PENDIENTE', $10)
       RETURNING id, codigo, estado, fecha_solicitud`,
      [codigo, factura.numero, factura.cliente_nit, factura.fecha, tipo, motivo_id, observaciones,
        factura.metodo_pago ?? "No registrado", monto_total, cajero]
    );
    for (const it of items) {
      await client.query(
        `INSERT INTO devoluciones.devolucion_items (devolucion_id, descripcion, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [rows[0].id, it.descripcion, it.cantidad, it.precio_unitario, it.subtotal]
      );
    }
    return { id: Number(rows[0].id), codigo: rows[0].codigo, estado: rows[0].estado, fecha_solicitud: rows[0].fecha_solicitud };
  });
}

module.exports = { listarMotivosActivos, obtenerMotivoActivo, cantidadesYaDevueltas, crearDevolucion };
