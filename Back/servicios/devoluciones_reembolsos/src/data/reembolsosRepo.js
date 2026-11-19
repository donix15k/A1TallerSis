const { query, withTransaction } = require("../config/db");

/** Nombre de la pasarela segun el tipo de reversion. */
const PASARELA_DE = { REVERSION_TARJETA: "Pasarela de tarjetas", REVERSION_QR: "Pasarela QR" };

/**
 * TDSI-48: guarda los reembolsos de una devolucion dentro de la transaccion `client` (la misma que la deja PROCESADA).
 *  - EFECTIVO: ya se entrego -> estado PROCESADO con la hora.
 *  - REVERSION_TARJETA / REVERSION_QR: quedan PENDIENTE y se crea su envio a la pasarela (PENDIENTE, 0 intentos) para
 *    que el proceso de reintentos lo envie.
 * Los indices unicos (devolucion_id, tipo) y (reembolso_id) impiden guardar dos veces el mismo reembolso.
 * Devuelve los reembolsos guardados: [{ id, tipo, monto, estado, procesado_en, envio_id }].
 */
async function guardarReembolsos(client, devolucionId, plan) {
  const guardados = [];
  for (const p of plan) {
    const esEfectivo = p.tipo === "EFECTIVO";
    const { rows } = await client.query(
      `INSERT INTO devoluciones.reembolsos (devolucion_id, tipo, monto, estado, procesado_en)
       VALUES ($1, $2, $3, $4, ${esEfectivo ? "now()" : "NULL"})
       RETURNING id, tipo, monto, estado, procesado_en`,
      [devolucionId, p.tipo, p.monto, esEfectivo ? "PROCESADO" : "PENDIENTE"]
    );
    const r = rows[0];
    let envioId = null;
    if (!esEfectivo) {
      const { rows: envio } = await client.query(
        `INSERT INTO devoluciones.envios_pasarela (reembolso_id, pasarela) VALUES ($1, $2) RETURNING id`,
        [r.id, PASARELA_DE[p.tipo]]
      );
      envioId = Number(envio[0].id);
    }
    guardados.push({ id: Number(r.id), tipo: r.tipo, monto: Number(r.monto), estado: r.estado, procesado_en: r.procesado_en, envio_id: envioId });
  }
  return guardados;
}

/** Reembolsos de una devolucion, con el estado de su envio a la pasarela (si lo tiene). */
async function listarPorDevolucion(devolucionId) {
  const { rows } = await query(
    `SELECT r.id, r.tipo, r.monto, r.estado, r.procesado_en,
            e.id AS envio_id, e.pasarela, e.estado AS envio_estado, e.intentos, e.enviado_en, e.ultimo_error, e.proximo_intento_en
       FROM devoluciones.reembolsos r
       LEFT JOIN devoluciones.envios_pasarela e ON e.reembolso_id = r.id
      WHERE r.devolucion_id = $1
      ORDER BY r.id`,
    [devolucionId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    tipo: r.tipo,
    monto: Number(r.monto),
    estado: r.estado,
    procesado_en: r.procesado_en,
    envio: r.envio_id
      ? {
          id: Number(r.envio_id),
          pasarela: r.pasarela,
          estado: r.envio_estado,
          intentos: r.intentos,
          enviado_en: r.enviado_en,
          ultimo_error: r.ultimo_error,
          proximo_intento_en: r.proximo_intento_en,
        }
      : null,
  }));
}

/** Ids de los envios PENDIENTES cuyo reintento ya toca (mas viejos primero). Con `reembolsoIds`, solo los de esos reembolsos. */
async function idsPendientes({ limite = 20, reembolsoIds = null } = {}) {
  const { rows } = await query(
    `SELECT e.id FROM devoluciones.envios_pasarela e
      WHERE e.estado = 'PENDIENTE'
        AND (e.proximo_intento_en IS NULL OR e.proximo_intento_en <= now())
        ${reembolsoIds ? "AND e.reembolso_id = ANY($2::bigint[])" : ""}
      ORDER BY e.id
      LIMIT $1`,
    reembolsoIds ? [limite, reembolsoIds] : [limite]
  );
  return rows.map((r) => Number(r.id));
}

/**
 * Toma UN envio con candado de fila (`FOR UPDATE SKIP LOCKED`) y vuelve a comprobar que siga PENDIENTE y le toque:
 * si otro proceso lo esta enviando o ya lo envio, devuelve null y no se envia dos veces.
 */
async function tomarEnvio(client, id) {
  const { rows } = await client.query(
    `SELECT e.id, e.reembolso_id, e.pasarela, e.intentos, r.tipo, r.monto, d.codigo AS devolucion_codigo
       FROM devoluciones.envios_pasarela e
       JOIN devoluciones.reembolsos r ON r.id = e.reembolso_id
       JOIN devoluciones.devoluciones d ON d.id = r.devolucion_id
      WHERE e.id = $1 AND e.estado = 'PENDIENTE' AND (e.proximo_intento_en IS NULL OR e.proximo_intento_en <= now())
      FOR UPDATE OF e SKIP LOCKED`,
    [id]
  );
  const r = rows[0];
  return r ? { ...r, id: Number(r.id), reembolso_id: Number(r.reembolso_id), monto: Number(r.monto) } : null;
}

/** La pasarela acepto la reversion: el envio queda ENVIADO y el reembolso PROCESADO. */
async function marcarEnviado(client, envio) {
  await client.query(
    `UPDATE devoluciones.envios_pasarela SET estado = 'ENVIADO', intentos = intentos + 1, enviado_en = now(), ultimo_error = NULL, proximo_intento_en = NULL WHERE id = $1`,
    [envio.id]
  );
  await client.query(`UPDATE devoluciones.reembolsos SET estado = 'PROCESADO', procesado_en = now() WHERE id = $1`, [envio.reembolso_id]);
}

/**
 * Fallo al enviar: suma un intento y guarda el error. Si ya se agotaron los intentos, el envio y el reembolso quedan
 * en ERROR (no se reintenta mas); si no, sigue PENDIENTE con la hora del proximo reintento (`esperaSegundos`).
 * Devuelve true si se agotaron los intentos.
 */
async function registrarFallo(client, envio, mensaje, { maxIntentos, esperaSegundos }) {
  const intentos = envio.intentos + 1;
  const agotado = intentos >= maxIntentos;
  await client.query(
    `UPDATE devoluciones.envios_pasarela
        SET intentos = $2, ultimo_error = $3, estado = $4,
            proximo_intento_en = ${agotado ? "NULL" : "now() + make_interval(secs => $5)"}
      WHERE id = $1`,
    agotado ? [envio.id, intentos, String(mensaje).slice(0, 400), "ERROR"] : [envio.id, intentos, String(mensaje).slice(0, 400), "PENDIENTE", esperaSegundos]
  );
  if (agotado) await client.query(`UPDATE devoluciones.reembolsos SET estado = 'ERROR' WHERE id = $1`, [envio.reembolso_id]);
  return agotado;
}

module.exports = { guardarReembolsos, listarPorDevolucion, idsPendientes, tomarEnvio, marcarEnviado, registrarFallo, withTransaction };
