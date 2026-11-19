const { query } = require("../config/db");

async function listarPorTurno(turnoId) {
  const { rows } = await query(
    `SELECT * FROM caja.movimientos WHERE turno_id = $1 ORDER BY id`,
    [turnoId]
  );
  return rows;
}

/**
 * Inserta el movimiento. Los de origen DEVOLUCIONES son unicos por referencia (el codigo DEV-NNNN): si ya existe uno,
 * no inserta y devuelve { duplicado: true, movimiento: el que ya estaba } -- asi repetir la misma devolucion nunca
 * saca el efectivo dos veces (el indice uq_movimientos_devolucion lo garantiza incluso con pedidos simultaneos).
 * Para los demas origenes devuelve la fila insertada, como siempre.
 */
async function insertar({ caja_id, turno_id, tipo, metodo, monto, origen_microservicio, referencia_externa, descripcion }) {
  const origen = origen_microservicio || "LOCAL";
  const valores = [caja_id, turno_id, tipo, metodo, monto, origen, referencia_externa || null, descripcion || null];

  if (origen === "DEVOLUCIONES") {
    const { rows } = await query(
      `INSERT INTO caja.movimientos
         (caja_id, turno_id, tipo, metodo, monto, origen_microservicio, referencia_externa, descripcion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (referencia_externa) WHERE origen_microservicio = 'DEVOLUCIONES' DO NOTHING
       RETURNING *`,
      valores
    );
    if (rows[0]) return rows[0];
    const { rows: existente } = await query(
      `SELECT * FROM caja.movimientos WHERE origen_microservicio = 'DEVOLUCIONES' AND referencia_externa = $1`,
      [referencia_externa]
    );
    return { duplicado: true, movimiento: existente[0] };
  }

  const { rows } = await query(
    `INSERT INTO caja.movimientos
       (caja_id, turno_id, tipo, metodo, monto, origen_microservicio, referencia_externa, descripcion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    valores
  );
  return rows[0];
}

module.exports = { listarPorTurno, insertar };