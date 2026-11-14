const { query } = require("../config/db");

// TDSI-964: deja constancia en el log compartido de "Verificación de Pub/Sub"
// (pagos.pubsub_verificaciones, misma base de datos que gestion_pagos) de cada aviso
// real a Contabilidad, no solo de las pruebas manuales de esa pantalla.
async function registrar({ grupo, grupo_origen, topico, mensaje, payload_enviado, ok, message_id, error, enviado_por }) {
  const { rows } = await query(
    `INSERT INTO pagos.pubsub_verificaciones (grupo, grupo_origen, topico, mensaje, payload_enviado, ok, message_id, error, enviado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, grupo, grupo_origen, topico, mensaje, payload_enviado, ok, message_id, error, enviado_por, creado_en`,
    [grupo, grupo_origen, topico, mensaje, payload_enviado, ok, message_id || null, error || null, enviado_por || null]
  );
  return rows[0];
}

module.exports = { registrar };
