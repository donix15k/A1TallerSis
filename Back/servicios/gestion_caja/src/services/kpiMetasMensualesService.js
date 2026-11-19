const metasMensualesRepo = require("../data/metasMensualesRepo");
const metasRepo = require("../data/metasVentaRepo");
const cajasRepo = require("../data/cajasRepo");
const { AppError } = require("../utils/AppError");

const MONTO_MAXIMO = 1_000_000_000; // un tope razonable: evita un cero de mas que dispararia el cumplimiento a 0 %

/**
 * TDSI-200: la meta MENSUAL de cada caja ACTIVA (las filas "Meta Caja N" de "Configurar objetivos"): { caja_id, caja_nombre,
 * monto_mensual (null si aun no tiene), meta_diaria (la de "Metas de venta", que se usa si no hay mensual), actualizado_por, actualizado_en }.
 */
async function listarMetasMensuales() {
  const [cajas, mensuales, diarias] = await Promise.all([cajasRepo.listarActivas(), metasMensualesRepo.listarTodas(), metasRepo.listarTodas()]);
  const mensualDe = new Map(mensuales.map((m) => [m.caja_id, m]));
  const diariaDe = new Map(diarias.map((m) => [m.caja_id, m.monto_meta]));
  return cajas.map((c) => {
    const m = mensualDe.get(c.codigo);
    return {
      caja_id: c.codigo,
      caja_nombre: c.nombre,
      monto_mensual: m ? m.monto_mensual : null,
      meta_diaria: diariaDe.get(c.codigo) ?? null,
      actualizado_por: m ? m.actualizado_por : null,
      actualizado_en: m ? m.actualizado_en : null,
    };
  });
}

/** El monto de una meta: numero mayor a 0, hasta 2 decimales y no absurdo. Devuelve el mensaje de error o null. */
function errorDeMonto(valor) {
  if (valor === null || valor === undefined || valor === "" || typeof valor === "boolean") return "La meta es obligatoria.";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "La meta debe ser un número.";
  if (n <= 0) return "La meta debe ser mayor a 0.";
  if (n > MONTO_MAXIMO) return `La meta no puede superar Bs ${MONTO_MAXIMO.toLocaleString("en-US")}.`;
  if (Math.round(n * 100) / 100 !== n) return "La meta admite hasta 2 decimales.";
  return null;
}

/**
 * TDSI-201/202: guarda la meta mensual de una o varias cajas. Todo o nada: si UNA meta es invalida no se guarda ninguna y la respuesta
 * 400 trae "errores" con el campo de cada una ({ campo: "metas_cajas.CAJA-01", mensaje }) para marcar el campo en la ventana.
 * Reglas: la caja existe y esta activa, la meta es mayor a 0 (hasta 2 decimales) y una caja no se repite.
 */
async function guardarMetasMensuales({ metas, actualizado_por } = {}) {
  if (!Array.isArray(metas) || metas.length === 0) {
    throw new AppError("Envíe al menos una meta mensual en 'metas' ([{ caja_id, monto_mensual }]).", 400);
  }
  const activas = new Map((await cajasRepo.listarActivas()).map((c) => [c.codigo, c]));
  const errores = [];
  const vistas = new Set();
  const limpias = [];
  metas.forEach((m, i) => {
    const cajaId = m && typeof m.caja_id === "string" ? m.caja_id.trim() : "";
    const campo = `metas_cajas.${cajaId || i}`;
    if (!cajaId) return errores.push({ campo, mensaje: "Falta el id de la caja." });
    if (vistas.has(cajaId)) return errores.push({ campo, mensaje: "La caja está repetida." });
    vistas.add(cajaId);
    if (!activas.has(cajaId)) return errores.push({ campo, mensaje: `La caja "${cajaId}" no existe o no está activa.` });
    const e = errorDeMonto(m.monto_mensual);
    if (e) return errores.push({ campo, mensaje: e });
    limpias.push({ caja_id: cajaId, monto_mensual: Number(m.monto_mensual) });
  });
  if (errores.length) throw new AppError("Hay metas mensuales que no se pueden guardar.", 400, { errores });

  await metasMensualesRepo.guardarVarias(limpias, actualizado_por);
  return listarMetasMensuales();
}

module.exports = { listarMetasMensuales, guardarMetasMensuales, errorDeMonto, MONTO_MAXIMO };
