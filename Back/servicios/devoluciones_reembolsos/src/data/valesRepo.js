const crypto = require("crypto");
const { query } = require("../config/db");

// Sin 0/O ni 1/I/L para que el codigo se lea y se escriba sin confundirse (VAL-4F8K2A).
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LARGO = 6;
const DIAS_VIGENCIA = 90;
const INTENTOS_CODIGO = 8;

function codigoAleatorio() {
  const bytes = crypto.randomBytes(LARGO);
  let s = "";
  for (let i = 0; i < LARGO; i++) s += ALFABETO[bytes[i] % ALFABETO.length];
  return `VAL-${s}`;
}

function formatear(r) {
  return {
    id: Number(r.id),
    codigo: r.codigo,
    monto: Number(r.monto),
    saldo_disponible: Number(r.saldo_disponible),
    estado: r.estado,
    emitido_en: r.emitido_en,
    expira_en: r.expira_en,
  };
}

/**
 * TDSI-68: emite el vale de compra de una devolucion dentro de la transaccion `client`: codigo unico VAL-XXXXXX,
 * saldo igual al monto devuelto, estado ACTIVO y vencimiento a 90 dias. Si el codigo aleatorio ya existe (muy raro)
 * se genera otro; el indice unico de devolucion_id impide emitir dos vales por la misma devolucion.
 */
async function emitirVale(client, devolucionId, monto) {
  for (let intento = 0; intento < INTENTOS_CODIGO; intento++) {
    const codigo = codigoAleatorio();
    // SAVEPOINT: un choque de codigo no debe abortar la transaccion completa del reembolso.
    await client.query("SAVEPOINT emitir_vale");
    try {
      const { rows } = await client.query(
        `INSERT INTO devoluciones.vales_compra (devolucion_id, codigo, monto, saldo_disponible, estado, expira_en)
         VALUES ($1, $2, $3, $3, 'ACTIVO', now() + make_interval(days => $4))
         RETURNING id, codigo, monto, saldo_disponible, estado, emitido_en, expira_en`,
        [devolucionId, codigo, monto, DIAS_VIGENCIA]
      );
      await client.query("RELEASE SAVEPOINT emitir_vale");
      return formatear(rows[0]);
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT emitir_vale");
      if (e.code === "23505" && /vales_compra_codigo_key/.test(e.constraint || "")) continue; // codigo repetido: otro
      throw e;
    }
  }
  throw new Error("No se pudo generar un código de vale único");
}

/** El vale por su codigo, o null si no existe. */
async function obtenerPorCodigo(codigo) {
  const { rows } = await query(
    `SELECT id, codigo, monto, saldo_disponible, estado, emitido_en, expira_en FROM devoluciones.vales_compra WHERE codigo = $1`,
    [codigo]
  );
  return rows[0] ? formatear(rows[0]) : null;
}

/** Bloquea la fila del vale (FOR UPDATE) dentro de la transaccion `client`; null si no existe. */
async function bloquearPorCodigo(client, codigo) {
  const { rows } = await client.query(
    `SELECT id, codigo, monto, saldo_disponible, estado, emitido_en, expira_en FROM devoluciones.vales_compra WHERE codigo = $1 FOR UPDATE`,
    [codigo]
  );
  return rows[0] ? formatear(rows[0]) : null;
}

/** El uso (no revertido) de un vale con esa referencia, o null. */
async function usoActivo(client, valeId, referencia) {
  const { rows } = await client.query(
    `SELECT id, monto, referencia, usado_en FROM devoluciones.vales_usos WHERE vale_id = $1 AND referencia = $2 AND revertido_en IS NULL`,
    [valeId, referencia]
  );
  return rows[0] ? { ...rows[0], id: Number(rows[0].id), monto: Number(rows[0].monto) } : null;
}

/** Descuenta `monto` del saldo (en centavos exactos); al llegar a 0 el vale queda USADO. Deja constancia del uso. */
async function descontar(client, vale, monto, referencia) {
  const { rows } = await client.query(
    `UPDATE devoluciones.vales_compra
        SET saldo_disponible = saldo_disponible - $2,
            estado = CASE WHEN saldo_disponible - $2 = 0 THEN 'USADO' ELSE estado END
      WHERE id = $1
      RETURNING id, codigo, monto, saldo_disponible, estado, emitido_en, expira_en`,
    [vale.id, monto]
  );
  await client.query(`INSERT INTO devoluciones.vales_usos (vale_id, monto, referencia) VALUES ($1, $2, $3)`, [vale.id, monto, referencia]);
  return formatear(rows[0]);
}

/** Devuelve el saldo de un uso (lo marca revertido) y reactiva el vale si estaba USADO y no ha vencido. */
async function reintegrar(client, vale, uso) {
  await client.query(`UPDATE devoluciones.vales_usos SET revertido_en = now() WHERE id = $1`, [uso.id]);
  const { rows } = await client.query(
    `UPDATE devoluciones.vales_compra
        SET saldo_disponible = saldo_disponible + $2,
            estado = CASE WHEN estado = 'USADO' AND (expira_en IS NULL OR expira_en > now()) THEN 'ACTIVO' ELSE estado END
      WHERE id = $1
      RETURNING id, codigo, monto, saldo_disponible, estado, emitido_en, expira_en`,
    [vale.id, uso.monto]
  );
  return formatear(rows[0]);
}

/** TDSI-71: marca EXPIRADO los vales ACTIVOS cuya fecha de vencimiento ya paso. Devuelve cuantos. */
async function marcarExpirados() {
  const { rowCount } = await query(
    `UPDATE devoluciones.vales_compra SET estado = 'EXPIRADO' WHERE estado = 'ACTIVO' AND expira_en IS NOT NULL AND expira_en <= now()`
  );
  return rowCount;
}

module.exports = { emitirVale, obtenerPorCodigo, bloquearPorCodigo, usoActivo, descontar, reintegrar, marcarExpirados, formatear, codigoAleatorio, DIAS_VIGENCIA };
