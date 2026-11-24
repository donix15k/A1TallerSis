// Nombre completo de las personas que aparecen en una devolucion: el cajero (que se guarda con su usuario, p. ej. "dmntrixc") y el supervisor (que se
// guarda con su codigo, p. ej. "SUP-DMN"). Se leen de las tablas de su dueño (caja.cajeros y facturacion.supervisores) solo para MOSTRARLOS: si no se puede
// leer, se devuelve vacio y la pantalla muestra solo el usuario o el codigo, como antes. Nunca falla.
const { query } = require("../config/db");

const unicos = (lista) => [...new Set((lista || []).map((v) => String(v ?? "").trim()).filter(Boolean))];

/** { cajeros: Map(usuario -> nombre), supervisores: Map(supervisor_id -> nombre) } para los usuarios y codigos indicados. */
async function resolverNombres({ cajeros = [], supervisores = [] } = {}) {
  const resultado = { cajeros: new Map(), supervisores: new Map() };
  const usuarios = unicos(cajeros);
  const codigos = unicos(supervisores);
  try {
    if (usuarios.length) {
      const { rows } = await query(
        `SELECT usuario, email_auth, nombre FROM caja.cajeros WHERE usuario = ANY($1) OR email_auth = ANY($1)`,
        [usuarios]
      );
      for (const r of rows) {
        if (usuarios.includes(r.usuario)) resultado.cajeros.set(r.usuario, r.nombre);
        if (r.email_auth && usuarios.includes(r.email_auth)) resultado.cajeros.set(r.email_auth, r.nombre);
      }
    }
    if (codigos.length) {
      const { rows } = await query(`SELECT supervisor_id, nombre FROM facturacion.supervisores WHERE supervisor_id = ANY($1)`, [codigos]);
      for (const r of rows) resultado.supervisores.set(r.supervisor_id, r.nombre);
    }
  } catch (e) {
    console.error("[nombres] no se pudieron leer los nombres:", e.message);
  }
  return resultado;
}

/** Quien hizo un cambio de estado: el supervisor (codigo SUP-...) o el cajero (usuario). Devuelve el nombre o null. */
const nombreDe = (nombres, persona) => (persona ? nombres.supervisores.get(persona) ?? nombres.cajeros.get(persona) ?? null : null);

module.exports = { resolverNombres, nombreDe };
