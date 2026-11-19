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

/**
 * TDSI-24: una devolucion completa por su codigo (DEV-0001): cabecera, motivo, items e historial de estados.
 * null si no existe.
 */
async function obtenerPorCodigo(codigo) {
  const { rows } = await query(
    `SELECT d.id, d.codigo, d.estado, d.tipo, d.factura_numero, d.cliente_nit, d.fecha_venta, d.fecha_solicitud,
            d.monto_total, d.requiere_autorizacion, d.observaciones, d.motivo_rechazo, d.autorizado_por,
            d.autorizado_en, d.creado_por, d.metodo_pago_original, m.id AS motivo_id, m.nombre AS motivo
       FROM devoluciones.devoluciones d
       LEFT JOIN devoluciones.motivos m ON m.id = d.motivo_id
      WHERE d.codigo = $1`,
    [codigo]
  );
  const d = rows[0];
  if (!d) return null;

  const { rows: items } = await query(
    `SELECT descripcion, cantidad, precio_unitario, subtotal FROM devoluciones.devolucion_items WHERE devolucion_id = $1 ORDER BY id`,
    [d.id]
  );
  const { rows: historial } = await query(
    `SELECT estado_anterior, estado_nuevo, cambiado_por, cambiado_en FROM devoluciones.historial_estados WHERE devolucion_id = $1 ORDER BY id`,
    [d.id]
  );

  return {
    codigo: d.codigo,
    estado: d.estado,
    tipo: d.tipo,
    factura_numero: d.factura_numero,
    cliente_nit: d.cliente_nit,
    fecha_venta: d.fecha_venta,
    fecha_solicitud: d.fecha_solicitud,
    monto_total: Number(d.monto_total),
    requiere_autorizacion: d.requiere_autorizacion,
    motivo: d.motivo_id ? { id: Number(d.motivo_id), nombre: d.motivo } : null,
    observaciones: d.observaciones,
    motivo_rechazo: d.motivo_rechazo,
    autorizado_por: d.autorizado_por,
    autorizado_en: d.autorizado_en,
    cajero: d.creado_por,
    metodo_pago_original: d.metodo_pago_original,
    items: items.map((i) => ({
      descripcion: i.descripcion,
      cantidad: Number(i.cantidad),
      precio_unitario: Number(i.precio_unitario),
      subtotal: Number(i.subtotal),
    })),
    historial,
  };
}

/**
 * TDSI-33: lista de devoluciones para la bandeja del supervisor (codigo, factura, cajero, monto, motivo, fecha y
 * si requiere autorizacion). Con estado filtra por ese estado; sin estado trae todas. La cola de PENDIENTES va
 * de la mas antigua a la mas nueva (se atiende en orden de llegada); las demas, de la mas reciente a la mas antigua.
 * Devuelve { total: cuantas hay en total con ese filtro, filas: hasta "limite" de ellas }.
 */
async function listarDevoluciones({ estado = null, limite = 200 } = {}) {
  const filtro = estado ? `WHERE d.estado = $1` : "";
  const parametros = estado ? [estado] : [];
  const orden = estado === "PENDIENTE" ? "d.fecha_solicitud ASC, d.id ASC" : "d.fecha_solicitud DESC, d.id DESC";

  const { rows: conteo } = await query(`SELECT count(*)::int AS total FROM devoluciones.devoluciones d ${filtro}`, parametros);
  const { rows } = await query(
    `SELECT d.codigo, d.estado, d.tipo, d.factura_numero, d.creado_por, d.monto_total, d.fecha_solicitud,
            d.requiere_autorizacion, m.id AS motivo_id, m.nombre AS motivo
       FROM devoluciones.devoluciones d
       LEFT JOIN devoluciones.motivos m ON m.id = d.motivo_id
       ${filtro}
      ORDER BY ${orden}
      LIMIT ${Number(limite)}`,
    parametros
  );
  return {
    total: conteo[0].total,
    filas: rows.map((d) => ({
      codigo: d.codigo,
      estado: d.estado,
      tipo: d.tipo,
      factura_numero: d.factura_numero,
      cajero: d.creado_por,
      monto_total: Number(d.monto_total),
      motivo: d.motivo_id ? { id: Number(d.motivo_id), nombre: d.motivo } : null,
      fecha_solicitud: d.fecha_solicitud,
      requiere_autorizacion: d.requiere_autorizacion,
    })),
  };
}

/**
 * TDSI-35: pasa una devolucion de PENDIENTE a APROBADA guardando quien la autorizo y cuando. El UPDATE solo
 * toca filas que SIGAN en PENDIENTE, asi que si dos supervisores aprueban a la vez solo uno lo logra.
 * Devuelve true si la aprobo, false si ya no estaba pendiente (o no existe).
 */
async function aprobarPendiente(codigo, supervisorId) {
  return resolverPendiente(
    codigo,
    "APROBADA",
    supervisorId,
    `UPDATE devoluciones.devoluciones
        SET estado = 'APROBADA', autorizado_por = $2, autorizado_en = now()
      WHERE codigo = $1 AND estado = 'PENDIENTE'
      RETURNING id`,
    [codigo, supervisorId]
  );
}

/**
 * TDSI-37: cambia el estado de una devolucion que SIGUE en PENDIENTE y registra el cambio en historial_estados
 * (PENDIENTE -> nuevo estado, hecho por el supervisor) en la MISMA transaccion: o quedan los dos o ninguno.
 * Si la devolucion ya no estaba pendiente (otro supervisor la resolvio justo antes) no cambia nada, no deja
 * historial y devuelve false (el servicio responde 409).
 */
async function resolverPendiente(codigo, nuevoEstado, supervisorId, sqlUpdate, parametros) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(sqlUpdate, parametros);
    if (rows.length === 0) return false;
    await client.query(
      `INSERT INTO devoluciones.historial_estados (devolucion_id, estado_anterior, estado_nuevo, cambiado_por)
       VALUES ($1, 'PENDIENTE', $2, $3)`,
      [rows[0].id, nuevoEstado, supervisorId]
    );
    return true;
  });
}

/**
 * TDSI-36: pasa una devolucion de PENDIENTE a RECHAZADA guardando el motivo del rechazo. Igual que al aprobar,
 * solo toca filas que SIGAN en PENDIENTE. Devuelve true si la rechazo, false si ya no estaba pendiente.
 */
async function rechazarPendiente(codigo, motivoRechazo, supervisorId) {
  return resolverPendiente(
    codigo,
    "RECHAZADA",
    supervisorId,
    `UPDATE devoluciones.devoluciones
        SET estado = 'RECHAZADA', motivo_rechazo = $2
      WHERE codigo = $1 AND estado = 'PENDIENTE'
      RETURNING id`,
    [codigo, motivoRechazo]
  );
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
async function crearDevolucion({ factura, comprados, tipo, monto_total, motivo_id, observaciones, items, cajero, requiere_autorizacion = false }) {
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
          metodo_pago_original, monto_total, estado, creado_por, requiere_autorizacion)
       VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8, $9, 'PENDIENTE', $10, $11)
       RETURNING id, codigo, estado, fecha_solicitud, requiere_autorizacion`,
      [codigo, factura.numero, factura.cliente_nit, factura.fecha, tipo, motivo_id, observaciones,
        factura.metodo_pago ?? "No registrado", monto_total, cajero, requiere_autorizacion]
    );
    for (const it of items) {
      await client.query(
        `INSERT INTO devoluciones.devolucion_items (devolucion_id, descripcion, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [rows[0].id, it.descripcion, it.cantidad, it.precio_unitario, it.subtotal]
      );
    }

    // 4) TDSI-23: primer movimiento del historial (sin estado anterior -> PENDIENTE), en la misma transaccion.
    await client.query(
      `INSERT INTO devoluciones.historial_estados (devolucion_id, estado_anterior, estado_nuevo, cambiado_por)
       VALUES ($1, NULL, 'PENDIENTE', $2)`,
      [rows[0].id, cajero]
    );
    return {
      id: Number(rows[0].id),
      codigo: rows[0].codigo,
      estado: rows[0].estado,
      fecha_solicitud: rows[0].fecha_solicitud,
      requiere_autorizacion: rows[0].requiere_autorizacion,
    };
  });
}

/**
 * TDSI-49: bloquea la fila de la devolucion (FOR UPDATE) dentro de la transaccion `client` y devuelve su estado ACTUAL.
 * Si dos cajeros reembolsan a la vez, el segundo espera aqui y, cuando el primero termina, la ve ya PROCESADA.
 * null si no existe.
 */
async function bloquearParaReembolso(client, codigo) {
  const { rows } = await client.query(
    `SELECT id, codigo, estado, monto_total FROM devoluciones.devoluciones WHERE codigo = $1 FOR UPDATE`,
    [codigo]
  );
  return rows[0] ? { id: Number(rows[0].id), codigo: rows[0].codigo, estado: rows[0].estado, monto_total: Number(rows[0].monto_total) } : null;
}

/** TDSI-49: APROBADA -> PROCESADA, con su fila en historial_estados (quien reembolso), en la transaccion `client`. */
async function marcarProcesada(client, devolucionId, cajero) {
  const { rowCount } = await client.query(
    `UPDATE devoluciones.devoluciones SET estado = 'PROCESADA' WHERE id = $1 AND estado = 'APROBADA'`,
    [devolucionId]
  );
  if (rowCount !== 1) throw new AppError("La devolución ya no está APROBADA.", 409);
  await client.query(
    `INSERT INTO devoluciones.historial_estados (devolucion_id, estado_anterior, estado_nuevo, cambiado_por) VALUES ($1, 'APROBADA', 'PROCESADA', $2)`,
    [devolucionId, cajero]
  );
}

module.exports = { bloquearParaReembolso, marcarProcesada, listarMotivosActivos, obtenerMotivoActivo, cantidadesYaDevueltas, obtenerPorCodigo, listarDevoluciones, aprobarPendiente, rechazarPendiente, crearDevolucion };
