const { query } = require("../config/db");

const COLS = "id, grupo, grupo_origen, topico, mensaje, payload_enviado, ok, message_id, error, enviado_por, direccion, servicio, tipo, referencia, creado_en";

/**
 * TDSI-958/960/963: deja constancia de cada intento manual de "Verificacion de
 * Pub/Sub". grupo_origen es desde que grupo se simulo el envio (A por defecto, el
 * real); grupo es el tópico destino. payload_enviado es el cuerpo JSON exacto que se
 * publico (mensaje + sistema_origen + fecha + correo de quien lo mando), para poder
 * mostrarlo tal cual en el log.
 */
async function registrar({ grupo, grupo_origen, topico, mensaje, payload_enviado, ok, message_id, error, enviado_por, direccion = "ENVIADO", servicio = null, tipo = null, referencia = null }) {
  const { rows } = await query(
    `INSERT INTO pagos.pubsub_verificaciones (grupo, grupo_origen, topico, mensaje, payload_enviado, ok, message_id, error, enviado_por, direccion, servicio, tipo, referencia)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, grupo, grupo_origen, topico, mensaje, payload_enviado, ok, message_id, error, enviado_por, direccion, servicio, tipo, referencia, creado_en`,
    [grupo, grupo_origen, topico, mensaje, payload_enviado, ok, message_id || null, error || null, enviado_por || null, direccion, servicio, tipo, referencia]
  );
  return rows[0];
}

/** Las ultimas verificaciones, mas reciente primero (para el "log" de la pantalla). */
async function listar(limite = 50) {
  const { rows } = await query(
    `SELECT ${COLS}
       FROM pagos.pubsub_verificaciones
      ORDER BY creado_en DESC, id DESC
      LIMIT $1`,
    [limite]
  );
  return rows;
}

module.exports = { registrar, listar };
