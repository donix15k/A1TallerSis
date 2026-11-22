const { query } = require("../config/db");
const { claveIdempotencia } = require("../services/contabilidadMensaje");

// TDSI-92: control de los envios de notas de credito a Contabilidad (devoluciones.envios_contabilidad_nc).
const COLUMNAS = `e.id, e.nota_credito_id, n.numero AS nota_numero, d.codigo AS devolucion_codigo, e.idempotency_key, e.estado, e.intentos,
                  e.ultimo_intento_en, e.ultimo_error, e.pubsub_message_id, e.proximo_intento_en, e.enviado_en, e.creado_en,
                  e.resultado, e.numero_asiento, e.resultado_motivo, e.resultado_en`;
const DESDE = `FROM devoluciones.envios_contabilidad_nc e
               JOIN devoluciones.notas_credito n ON n.id = e.nota_credito_id
               JOIN devoluciones.devoluciones d ON d.id = n.devolucion_id`;

function aEnvio(fila) {
  return fila ? { ...fila, id: Number(fila.id), nota_credito_id: Number(fila.nota_credito_id) } : null;
}

async function obtener(id, { conPayload = false } = {}) {
  const { rows } = await query(`SELECT ${COLUMNAS}${conPayload ? ", e.payload" : ""} ${DESDE} WHERE e.id = $1`, [id]);
  return aEnvio(rows[0]);
}

async function obtenerPorNota(notaId, { conPayload = false } = {}) {
  const { rows } = await query(`SELECT ${COLUMNAS}${conPayload ? ", e.payload" : ""} ${DESDE} WHERE e.nota_credito_id = $1`, [notaId]);
  return aEnvio(rows[0]);
}

async function obtenerPorDevolucionCodigo(codigo, { conPayload = false } = {}) {
  const { rows } = await query(`SELECT ${COLUMNAS}${conPayload ? ", e.payload" : ""} ${DESDE} WHERE d.codigo = $1`, [codigo]);
  return aEnvio(rows[0]);
}

/**
 * Registra el envio (Pendiente, 0 intentos) con el mensaje que se va a publicar. idempotency_key = nc-{numero}: una nota
 * tiene un solo envio; si ya existe devuelve { yaExiste } sin crear otro. proximo_intento_en queda 2 minutos adelante:
 * si el primer intento nunca termina (el servicio se cae), el proceso de reintentos lo retoma.
 */
async function crear({ notaId, numero, payload }) {
  const { rows } = await query(
    `INSERT INTO devoluciones.envios_contabilidad_nc (nota_credito_id, idempotency_key, estado, intentos, payload, proximo_intento_en)
     VALUES ($1, $2, 'Pendiente', 0, $3, now() + interval '2 minutes')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [notaId, claveIdempotencia(numero), JSON.stringify(payload)]
  );
  if (!rows[0]) return { yaExiste: await obtenerPorNota(notaId) };
  return { envio: await obtener(rows[0].id, { conPayload: true }) };
}

async function marcarEnviado(id, messageId) {
  await query(
    `UPDATE devoluciones.envios_contabilidad_nc
        SET estado = 'Enviado', intentos = intentos + 1, ultimo_intento_en = now(), ultimo_error = NULL,
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
    `UPDATE devoluciones.envios_contabilidad_nc
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
    `UPDATE devoluciones.envios_contabilidad_nc
        SET proximo_intento_en = now() + interval '2 minutes'
      WHERE id IN (
        SELECT id FROM devoluciones.envios_contabilidad_nc
         WHERE estado = 'Pendiente' AND proximo_intento_en <= now()
         ORDER BY proximo_intento_en
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, nota_credito_id, payload, intentos`,
    [limite]
  );
  return rows.map(aEnvio);
}

/** "Reenviar" un envio en Error o ya Enviado pero RECHAZADO por Contabilidad (se borra el resultado anterior). Null en cualquier otro caso. */
async function prepararReenvio(id) {
  const { rows } = await query(
    `UPDATE devoluciones.envios_contabilidad_nc
        SET estado = 'Pendiente', intentos = 0, proximo_intento_en = now() + interval '2 minutes',
            resultado = NULL, numero_asiento = NULL, resultado_motivo = NULL, resultado_en = NULL
      WHERE id = $1 AND (estado = 'Error' OR (estado = 'Enviado' AND lower(coalesce(resultado, '')) = 'rechazado'))
      RETURNING id`,
    [id]
  );
  return rows[0] ? obtener(id, { conPayload: true }) : null;
}

/**
 * TDSI-94: guarda la respuesta de Contabilidad (resultado_documento) en el envio de esa nota.
 * Devuelve el envio actualizado, o null si no hay un envio con ese numero de nota.
 */
async function registrarResultado({ notaNumero, resultado, numeroAsiento, motivo, messageId, publicadoEn = null }) {
  const { rows } = await query(
    `UPDATE devoluciones.envios_contabilidad_nc e
        SET resultado = $2, numero_asiento = $3, resultado_motivo = $4, resultado_en = now(), resultado_message_id = $5
       FROM devoluciones.notas_credito n
      WHERE n.id = e.nota_credito_id AND n.numero = $1
        AND ($6::timestamptz IS NULL OR e.enviado_en IS NULL OR $6::timestamptz >= e.enviado_en - interval '2 seconds')
      RETURNING e.id`,
    [notaNumero, resultado, numeroAsiento, motivo, messageId, publicadoEn]
  );
  return rows[0] ? obtener(rows[0].id) : null;
}

/** ¿Existe un envio con ese numero de nota? (distingue una respuesta vieja de una que no es nuestra) */
async function existeEnvio({ notaNumero }) {
  const { rows } = await query(`SELECT 1 FROM devoluciones.envios_contabilidad_nc e JOIN devoluciones.notas_credito n ON n.id = e.nota_credito_id WHERE n.numero = $1`, [notaNumero]);
  return rows.length > 0;
}

/**
 * Estado que ve el administrador en la columna "Contabilidad" (TDSI-96): Registrado (con N° de asiento) o Rechazado (con
 * motivo) cuando Contabilidad ya respondio; si no, el estado del envio: Pendiente, Enviado o Error.
 */
function estadoVisible({ estado, resultado, numero_asiento, resultado_motivo }) {
  const r = String(resultado || "").toLowerCase();
  let visible = estado;
  if (r === "registrado" || r === "rechazado") visible = r === "registrado" ? "Registrado" : "Rechazado";
  else if (r) visible = r.charAt(0).toUpperCase() + r.slice(1);
  return { estado: visible, numero_asiento: numero_asiento ?? null, motivo: resultado_motivo ?? null };
}

/** Cambia el mensaje que se va a (re)enviar (justificacion del reenvio de una nota rechazada). */
async function actualizarPayload(id, payload) {
  await query(`UPDATE devoluciones.envios_contabilidad_nc SET payload = $2 WHERE id = $1`, [id, JSON.stringify(payload)]);
}

module.exports = { estadoVisible, obtener, obtenerPorNota, obtenerPorDevolucionCodigo, crear, marcarEnviado, registrarFallo, tomarPendientes, prepararReenvio, actualizarPayload, registrarResultado, existeEnvio };
