const { query } = require("../config/db");

// TDSI-117: control de los avisos del resultado de una devolucion al Marketplace (devoluciones.envios_marketplace_dev).
const COLUMNAS = `e.id, e.devolucion_id, d.codigo AS devolucion_codigo, e.resultado, e.idempotency_key, e.estado, e.intentos,
                  e.ultimo_intento_en, e.ultimo_error, e.pubsub_message_id, e.proximo_intento_en, e.enviado_en, e.creado_en`;
const DESDE = `FROM devoluciones.envios_marketplace_dev e JOIN devoluciones.devoluciones d ON d.id = e.devolucion_id`;

function aEnvio(fila) {
  return fila ? { ...fila, id: Number(fila.id), devolucion_id: Number(fila.devolucion_id) } : null;
}

async function obtener(id, { conPayload = false } = {}) {
  const { rows } = await query(`SELECT ${COLUMNAS}${conPayload ? ", e.payload" : ""} ${DESDE} WHERE e.id = $1`, [id]);
  return aEnvio(rows[0]);
}

/** Los avisos de una devolucion (a lo mas uno por resultado), por su codigo DEV-XXXX. */
async function listarPorCodigo(codigo) {
  const { rows } = await query(`SELECT ${COLUMNAS} ${DESDE} WHERE d.codigo = $1 ORDER BY e.id`, [codigo]);
  return rows.map(aEnvio);
}

/**
 * Registra el aviso (Pendiente, 0 intentos) con el mensaje que se va a publicar. idempotency_key = codigo-RESULTADO: una
 * devolucion tiene un solo aviso por resultado; si ya existe devuelve { yaExiste } sin crear otro. proximo_intento_en queda
 * 2 minutos adelante: si el primer intento nunca termina, el proceso de reintentos lo retoma.
 */
async function crear({ devolucionId, codigo, resultado, payload }) {
  const { rows } = await query(
    `INSERT INTO devoluciones.envios_marketplace_dev (devolucion_id, resultado, idempotency_key, estado, intentos, payload, proximo_intento_en)
     VALUES ($1, $2, $3, 'Pendiente', 0, $4, now() + interval '2 minutes')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [devolucionId, resultado, `${codigo}-${resultado}`, JSON.stringify(payload)]
  );
  if (!rows[0]) {
    const { rows: previo } = await query(`SELECT ${COLUMNAS} ${DESDE} WHERE e.devolucion_id = $1 AND e.resultado = $2`, [devolucionId, resultado]);
    return { yaExiste: aEnvio(previo[0]) };
  }
  return { envio: await obtener(rows[0].id, { conPayload: true }) };
}

async function marcarEnviado(id, messageId) {
  await query(
    `UPDATE devoluciones.envios_marketplace_dev
        SET estado = 'Enviado', intentos = intentos + 1, ultimo_intento_en = now(), ultimo_error = NULL,
            pubsub_message_id = $2, proximo_intento_en = NULL, enviado_en = now()
      WHERE id = $1`,
    [id, messageId]
  );
  return obtener(id);
}

/** El intento fallo: reintentable y con intentos -> Pendiente con espera creciente (base, base*2, ...); si no, Error. */
async function registrarFallo(id, { error, reintentable }, maxIntentos, backoffBaseSeg) {
  await query(
    `UPDATE devoluciones.envios_marketplace_dev
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
    `UPDATE devoluciones.envios_marketplace_dev
        SET proximo_intento_en = now() + interval '2 minutes'
      WHERE id IN (
        SELECT id FROM devoluciones.envios_marketplace_dev
         WHERE estado = 'Pendiente' AND proximo_intento_en <= now()
         ORDER BY proximo_intento_en
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, devolucion_id, resultado, payload, intentos`,
    [limite]
  );
  return rows.map(aEnvio);
}

module.exports = { obtener, listarPorCodigo, crear, marcarEnviado, registrarFallo, tomarPendientes };
