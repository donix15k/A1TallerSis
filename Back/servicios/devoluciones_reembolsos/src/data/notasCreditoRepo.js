const { query } = require("../config/db");

const FORMATO = /^NC-(\d+)$/;
const numeroNC = (n) => `NC-${String(n).padStart(6, "0")}`;

/**
 * TDSI-57: emite la nota de credito de una devolucion dentro de la transaccion `client` (la misma que la deja PROCESADA).
 * Numeracion correlativa NC-000001, NC-000002, ...: el siguiente numero se calcula con un candado de la base
 * (advisory lock), asi dos devoluciones procesadas a la vez nunca reciben el mismo numero. Cada devolucion tiene
 * una sola nota (indice unico): emitir dos veces falla en vez de duplicar.
 */
async function emitirNota(client, devolucionId, monto) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('devoluciones.notas_credito.numero'))`);
  const { rows: max } = await client.query(
    `SELECT COALESCE(MAX(substring(numero from 4)::int), 0) AS ultimo FROM devoluciones.notas_credito WHERE numero ~ '^NC-[0-9]+$'`
  );
  const numero = numeroNC(Number(max[0].ultimo) + 1);
  const { rows } = await client.query(
    `INSERT INTO devoluciones.notas_credito (devolucion_id, numero, monto) VALUES ($1, $2, $3)
     RETURNING id, numero, monto, estado, emitida_en, enviada_por_correo, enviada_en`,
    [devolucionId, numero, monto]
  );
  return formatear(rows[0]);
}

function formatear(r) {
  return {
    id: Number(r.id),
    numero: r.numero,
    monto: Number(r.monto),
    estado: r.estado,
    emitida_en: r.emitida_en,
    enviada_por_correo: r.enviada_por_correo,
    enviada_en: r.enviada_en,
  };
}

/** La nota de credito de una devolucion (por su id), o null si todavia no tiene. */
async function obtenerPorDevolucion(devolucionId) {
  const { rows } = await query(
    `SELECT id, numero, monto, estado, emitida_en, enviada_por_correo, enviada_en FROM devoluciones.notas_credito WHERE devolucion_id = $1`,
    [devolucionId]
  );
  return rows[0] ? formatear(rows[0]) : null;
}

/** TDSI-60: la nota ya se envio por correo: enviada_por_correo = true y la hora (se actualiza en cada reenvio exitoso). */
async function marcarEnviada(notaId) {
  const { rows } = await query(
    `UPDATE devoluciones.notas_credito SET enviada_por_correo = true, enviada_en = now() WHERE id = $1
     RETURNING id, numero, monto, estado, emitida_en, enviada_por_correo, enviada_en`,
    [notaId]
  );
  return formatear(rows[0]);
}

module.exports = { emitirNota, obtenerPorDevolucion, marcarEnviada, numeroNC, FORMATO };
