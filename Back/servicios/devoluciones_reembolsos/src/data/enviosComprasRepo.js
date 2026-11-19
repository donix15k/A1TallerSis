const { query } = require("../config/db");

// TDSI-104: control de los avisos de productos devueltos a Compras (devoluciones.envios_compras_dev).
const COLUMNAS = `e.id, e.devolucion_id, d.codigo AS devolucion_codigo, e.idempotency_key, e.estado, e.intentos, e.ultimo_intento_en,
                  e.ultimo_error, e.pubsub_message_id, e.proximo_intento_en, e.enviado_en, e.creado_en,
                  e.acuse, e.numero_reclamo, e.acuse_en`;
const DESDE = `FROM devoluciones.envios_compras_dev e JOIN devoluciones.devoluciones d ON d.id = e.devolucion_id`;

function aEnvio(fila) {
  return fila ? { ...fila, id: Number(fila.id), devolucion_id: Number(fila.devolucion_id) } : null;
}

async function obtener(id, { conPayload = false } = {}) {
  const { rows } = await query(`SELECT ${COLUMNAS}${conPayload ? ", e.payload" : ""} ${DESDE} WHERE e.id = $1`, [id]);
  return aEnvio(rows[0]);
}

async function obtenerPorDevolucionId(devolucionId, { conPayload = false } = {}) {
  const { rows } = await query(`SELECT ${COLUMNAS}${conPayload ? ", e.payload" : ""} ${DESDE} WHERE e.devolucion_id = $1`, [devolucionId]);
  return aEnvio(rows[0]);
}

async function obtenerPorCodigo(codigo, { conPayload = false } = {}) {
  const { rows } = await query(`SELECT ${COLUMNAS}${conPayload ? ", e.payload" : ""} ${DESDE} WHERE d.codigo = $1`, [codigo]);
  return aEnvio(rows[0]);
}

/**
 * Registra el aviso (Pendiente, 0 intentos) con el mensaje que se va a publicar. idempotency_key = codigo de la
 * devolucion: una devolucion tiene un solo aviso; si ya existe devuelve { yaExiste } sin crear otro. proximo_intento_en
 * queda 2 minutos adelante: si el primer intento nunca termina (el servicio se cae), el proceso de reintentos lo retoma.
 */
async function crear({ devolucionId, codigo, payload }) {
  const { rows } = await query(
    `INSERT INTO devoluciones.envios_compras_dev (devolucion_id, idempotency_key, estado, intentos, payload, proximo_intento_en)
     VALUES ($1, $2, 'Pendiente', 0, $3, now() + interval '2 minutes')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [devolucionId, codigo, JSON.stringify(payload)]
  );
  if (!rows[0]) return { yaExiste: await obtenerPorDevolucionId(devolucionId) };
  return { envio: await obtener(rows[0].id, { conPayload: true }) };
}

async function marcarEnviado(id, messageId) {
  await query(
    `UPDATE devoluciones.envios_compras_dev
        SET estado = CASE WHEN acuse IS NOT NULL THEN 'Recibido' ELSE 'Enviado' END,
            intentos = intentos + 1, ultimo_intento_en = now(), ultimo_error = NULL,
            pubsub_message_id = $2, proximo_intento_en = NULL, enviado_en = now()
      WHERE id = $1`,
    [id, messageId]
  );
  return obtener(id);
}

/**
 * El intento fallo: si es reintentable y quedan intentos sigue Pendiente con espera creciente (base, base*2, base*4...);
 * si no, queda en Error.
 */
async function registrarFallo(id, { error, reintentable }, maxIntentos, backoffBaseSeg) {
  await query(
    `UPDATE devoluciones.envios_compras_dev
        SET intentos = intentos + 1,
            ultimo_intento_en = now(),
            ultimo_error = $2,
            estado = CASE WHEN NOT $3::boolean OR intentos + 1 >= $4::int THEN 'Error' ELSE 'Pendiente' END,
            proximo_intento_en = CASE WHEN NOT $3::boolean OR intentos + 1 >= $4::int THEN NULL
                                      ELSE now() + make_interval(secs => $5::int * power(2, intentos)) END
      WHERE id = $1`,
    [id, String(error || "Error desconocido").slice(0, 400), Boolean(reintentable), maxIntentos, backoffBaseSeg]
  );
  return obtener(id);
}

/** Toma los Pendientes vencidos y los reserva 2 minutos (SKIP LOCKED: dos procesos nunca toman el mismo). */
async function tomarPendientes(limite = 10) {
  const { rows } = await query(
    `UPDATE devoluciones.envios_compras_dev
        SET proximo_intento_en = now() + interval '2 minutes'
      WHERE id IN (
        SELECT id FROM devoluciones.envios_compras_dev
         WHERE estado = 'Pendiente' AND proximo_intento_en <= now()
         ORDER BY proximo_intento_en
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, devolucion_id, payload, intentos`,
    [limite]
  );
  return rows.map(aEnvio);
}

/** "Reenviar" un aviso en Error: misma fila, nuevo ciclo de intentos. Null si no estaba en Error. */
async function prepararReenvio(id) {
  const { rows } = await query(
    `UPDATE devoluciones.envios_compras_dev
        SET estado = 'Pendiente', intentos = 0, proximo_intento_en = now() + interval '2 minutes'
      WHERE id = $1 AND estado = 'Error'
      RETURNING id`,
    [id]
  );
  return rows[0] ? obtener(id, { conPayload: true }) : null;
}

/**
 * TDSI-105: guarda el acuse de Compras (RECIBIDO o RECLAMO_REGISTRADO con N° de reclamo) en el aviso de esa devolucion.
 * El estado pasa a Recibido. Un acuse repetido no pisa la fecha del primero (el reclamo si se completa si llega despues
 * del RECIBIDO). Devuelve el aviso, o null si esa devolucion no tiene aviso.
 */
async function registrarAcuse({ codigo, acuse, numeroReclamo, messageId }) {
  const { rows } = await query(
    `UPDATE devoluciones.envios_compras_dev e
        SET estado = 'Recibido',
            acuse = CASE WHEN e.acuse = 'RECLAMO_REGISTRADO' THEN e.acuse ELSE $2 END,
            numero_reclamo = COALESCE($3, e.numero_reclamo),
            acuse_en = COALESCE(e.acuse_en, now()),
            acuse_message_id = COALESCE(e.acuse_message_id, $4)
       FROM devoluciones.devoluciones d
      WHERE d.id = e.devolucion_id AND d.codigo = $1
      RETURNING e.id`,
    [codigo, acuse, numeroReclamo, messageId]
  );
  return rows[0] ? obtener(rows[0].id) : null;
}

/** Estado que se ve en la seccion "Compras" del detalle: Enviado, Recibido (o Reclamo registrado N° X), Pendiente o Error. */
function estadoVisible({ estado, acuse, numero_reclamo }) {
  if (acuse === "RECLAMO_REGISTRADO") return { estado: "Reclamo registrado", numero_reclamo: numero_reclamo ?? null };
  return { estado, numero_reclamo: numero_reclamo ?? null };
}

module.exports = { obtener, obtenerPorDevolucionId, obtenerPorCodigo, crear, marcarEnviado, registrarFallo, tomarPendientes, prepararReenvio, registrarAcuse, estadoVisible };
