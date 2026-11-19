const { query } = require("../config/db");

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

module.exports = { listarMotivosActivos, obtenerMotivoActivo, cantidadesYaDevueltas };
