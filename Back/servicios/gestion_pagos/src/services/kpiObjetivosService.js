const { query, withTransaction } = require("../config/db");
const { AppError } = require("../utils/AppError");
const metasCaja = require("./metasCajaProxy");

// TDSI-190/191: los objetivos del semaforo del Panel de KPIs (pagos.kpi_objetivos). Cada indicador tiene tres limites y un sentido:
//   MAYOR (mas es mejor):  VERDE si valor >= verde;  AMARILLO si valor >= amarillo;  si no, ROJO.
//   MENOR (menos es mejor): VERDE si valor <= verde; AMARILLO si valor <= amarillo;  si no, ROJO.
// "rojo" es el extremo de la zona roja (tope de la barra semaforo). Los rangos iniciales son los del PDF; si la tabla no responde o falta
// una fila, se usan estos mismos (el panel nunca se queda sin color por un problema de configuracion).
const INDICADORES = [
  { indicador: "ticket_promedio", nombre: "Ticket promedio", unidad: "Bs", verde: 45, amarillo: 35, rojo: 0, sentido: "MAYOR" },
  { indicador: "tasa_anulacion", nombre: "Tasa de anulación", unidad: "%", verde: 2, amarillo: 5, rojo: 10, sentido: "MENOR" },
  { indicador: "tasa_devoluciones", nombre: "Tasa de devoluciones", unidad: "%", verde: 1.5, amarillo: 3, rojo: 6, sentido: "MENOR" },
  { indicador: "cumplimiento_metas", nombre: "Cumplimiento de metas", unidad: "%", verde: 100, amarillo: 70, rojo: 0, sentido: "MAYOR" },
  { indicador: "efectividad_cuadre", nombre: "Efectividad de cuadre", unidad: "%", verde: 95, amarillo: 85, rojo: 0, sentido: "MAYOR" },
  { indicador: "aceptacion_contable", nombre: "Aceptación contable", unidad: "%", verde: 98, amarillo: 95, rojo: 0, sentido: "MAYOR" },
  { indicador: "dias_pago_proveedores", nombre: "Días de pago a proveedores", unidad: "días", verde: 7, amarillo: 15, rojo: 30, sentido: "MENOR" },
];
const POR_DEFECTO = Object.fromEntries(INDICADORES.map((i) => [i.indicador, i]));

const aCentavos = (n) => Math.round(Number(n) * 100);

/**
 * TDSI-191: el color (VERDE, AMARILLO o ROJO) de un valor segun sus limites. null o NaN no tienen color (un indicador sin datos se
 * muestra sin color). Se compara en centavos para que 2,00 y 2.0000001 no cambien de color por el redondeo.
 */
function colorSegun(valor, limites) {
  if (valor === null || valor === undefined || valor === "" || !Number.isFinite(Number(valor))) return null;
  const v = aCentavos(valor);
  if (limites.sentido === "MENOR") {
    if (v <= aCentavos(limites.verde)) return "VERDE";
    if (v <= aCentavos(limites.amarillo)) return "AMARILLO";
    return "ROJO";
  }
  if (v >= aCentavos(limites.verde)) return "VERDE";
  if (v >= aCentavos(limites.amarillo)) return "AMARILLO";
  return "ROJO";
}

/** Los limites de un indicador que no esta guardado: los iniciales del PDF. */
function limitesPorDefecto(indicador) {
  const i = POR_DEFECTO[indicador];
  return i ? { ...i } : null;
}

const aObjetivo = (r) => ({
  indicador: r.indicador,
  nombre: r.nombre,
  unidad: r.unidad,
  verde: Number(r.limite_verde),
  amarillo: Number(r.limite_amarillo),
  rojo: Number(r.limite_rojo),
  sentido: r.sentido,
  actualizado_por: r.actualizado_por ?? null,
  actualizado_en: r.actualizado_en ?? null,
});

/**
 * TDSI-190: los objetivos de los 7 indicadores (en orden), de la tabla; una fila que falta se completa con los rangos iniciales.
 * Si la tabla no se puede leer devuelve los iniciales (nunca tumba al Panel).
 */
async function listarObjetivos() {
  let guardados = new Map();
  try {
    const { rows } = await query(`SELECT * FROM pagos.kpi_objetivos`);
    guardados = new Map(rows.map((r) => [r.indicador, aObjetivo(r)]));
  } catch (e) {
    console.error("[kpi] No se pudieron leer los objetivos, se usan los iniciales:", e.message);
  }
  return INDICADORES.map((i) => guardados.get(i.indicador) || { ...i, actualizado_por: null, actualizado_en: null });
}

/** Los limites vigentes de un indicador: { indicador, verde, amarillo, rojo, sentido, ... }. */
async function limitesDe(indicador) {
  return (await listarObjetivos()).find((o) => o.indicador === indicador) || limitesPorDefecto(indicador);
}

/** El color de un valor segun los objetivos VIGENTES de su indicador. */
async function colorDe(indicador, valor) {
  return colorSegun(valor, await limitesDe(indicador));
}

const MAXIMO = { "%": 100, Bs: 1_000_000, "días": 3650 }; // tope de cada unidad: los porcentajes van de 0 a 100

/** Un limite: numero entre 0 y el tope de su unidad, hasta 2 decimales. Devuelve el mensaje de error o null. */
function errorDeLimite(valor, unidad) {
  if (valor === null || valor === undefined || valor === "" || typeof valor === "boolean") return "Ingrese un valor.";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "Debe ser un número.";
  if (n < 0) return "No puede ser negativo.";
  const tope = MAXIMO[unidad] ?? 1_000_000;
  if (n > tope) return unidad === "%" ? "Los porcentajes van de 0 a 100." : `No puede superar ${tope}.`;
  if (Math.round(n * 100) / 100 !== n) return "Admite hasta 2 decimales.";
  return null;
}

/**
 * TDSI-201: valida los limites de UN indicador y devuelve sus errores por campo ([{ campo: "ticket_promedio.amarillo", mensaje }]).
 * Reglas: los tres limites son numeros validos (porcentajes de 0 a 100) y el AMARILLO queda siempre ENTRE el verde y el rojo
 * (MAYOR: rojo <= amarillo <= verde; MENOR: verde <= amarillo <= rojo). El sentido no se puede cambiar.
 */
function validarIndicador(entrada, base) {
  const errores = [];
  const c = (campo) => `${base.indicador}.${campo}`;
  const valores = {};
  for (const campo of ["verde", "amarillo", "rojo"]) {
    const e = errorDeLimite(entrada[campo], base.unidad);
    if (e) errores.push({ campo: c(campo), mensaje: e });
    else valores[campo] = Number(entrada[campo]);
  }
  if (entrada.sentido !== undefined && entrada.sentido !== base.sentido) {
    errores.push({ campo: c("sentido"), mensaje: `El sentido de este indicador es ${base.sentido} y no se puede cambiar.` });
  }
  if (errores.length) return { errores, valores: null };

  const { verde, amarillo, rojo } = valores;
  if (base.sentido === "MAYOR") {
    if (verde < rojo) errores.push({ campo: c("verde"), mensaje: "El verde debe ser mayor o igual al rojo." });
    else if (amarillo > verde || amarillo < rojo) errores.push({ campo: c("amarillo"), mensaje: "El amarillo debe quedar entre el verde y el rojo." });
  } else if (verde > rojo) {
    errores.push({ campo: c("verde"), mensaje: "El verde debe ser menor o igual al rojo." });
  } else if (amarillo < verde || amarillo > rojo) {
    errores.push({ campo: c("amarillo"), mensaje: "El amarillo debe quedar entre el verde y el rojo." });
  }
  return { errores, valores: errores.length ? null : valores };
}

/** TDSI-201: valida la lista de indicadores que manda "Configurar objetivos". Devuelve { errores, cambios: [{ indicador, verde, amarillo, rojo }] }. */
function validarIndicadores(lista) {
  const errores = [];
  const cambios = [];
  const vistos = new Set();
  lista.forEach((entrada, i) => {
    const id = entrada && typeof entrada.indicador === "string" ? entrada.indicador.trim() : "";
    const base = POR_DEFECTO[id];
    if (!base) return errores.push({ campo: `indicadores.${id || i}`, mensaje: `El indicador "${id}" no existe. Use: ${INDICADORES.map((x) => x.indicador).join(", ")}.` });
    if (vistos.has(id)) return errores.push({ campo: `${id}.indicador`, mensaje: "El indicador está repetido." });
    vistos.add(id);
    const r = validarIndicador(entrada, base);
    if (r.errores.length) errores.push(...r.errores);
    else cambios.push({ indicador: id, ...r.valores });
  });
  return { errores, cambios };
}

/**
 * TDSI-200: la ventana "Configurar objetivos": los limites de los 7 KPIs y la meta MENSUAL de cada caja activa. Si Gestion de Caja no
 * responde, las metas quedan vacias y "metas_error" dice por que (los limites se ven igual). conMetas=false es para los demas
 * servicios, que solo necesitan los limites.
 */
async function configuracion({ token, conMetas = true } = {}) {
  const indicadores = await listarObjetivos();
  if (!conMetas) return { indicadores };
  const metas = await metasCaja.listarMetasMensuales({ token });
  return { indicadores, metas_cajas: metas.cajas, metas_error: metas.error };
}

/**
 * TDSI-201/202: "Guardar" de "Configurar objetivos": aplica los limites de los indicadores (indicadores: [{ indicador, verde, amarillo,
 * rojo }]) y la meta mensual de las cajas (metas_cajas: [{ caja_id, monto_mensual }]), todo o nada. Cualquiera de las dos listas puede
 * ir sola. Un valor invalido es 400 con "errores" por campo y no se guarda nada. Los limites se guardan dentro de una transaccion que
 * solo se confirma si Caja acepto las metas.
 */
async function guardarObjetivos({ indicadores, metas_cajas: metasCajasEntrada, actualizado_por: actualizadoPor, token } = {}) {
  const hayIndicadores = indicadores !== undefined && indicadores !== null;
  const hayMetas = metasCajasEntrada !== undefined && metasCajasEntrada !== null;
  if ((hayIndicadores && !Array.isArray(indicadores)) || (hayMetas && !Array.isArray(metasCajasEntrada))) {
    throw new AppError("'indicadores' y 'metas_cajas' deben ser listas.", 400);
  }
  if (!(hayIndicadores && indicadores.length) && !(hayMetas && metasCajasEntrada.length)) {
    throw new AppError("No hay nada que guardar: envíe 'indicadores' y/o 'metas_cajas'.", 400);
  }

  const { errores, cambios } = hayIndicadores ? validarIndicadores(indicadores) : { errores: [], cambios: [] };
  if (errores.length) throw new AppError("Hay objetivos que no se pueden guardar.", 400, { errores });

  await withTransaction(async (client) => {
    for (const c of cambios) {
      const base = POR_DEFECTO[c.indicador];
      await client.query(
        `INSERT INTO pagos.kpi_objetivos (indicador, nombre, unidad, limite_verde, limite_amarillo, limite_rojo, sentido, actualizado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (indicador) DO UPDATE
           SET limite_verde = EXCLUDED.limite_verde, limite_amarillo = EXCLUDED.limite_amarillo, limite_rojo = EXCLUDED.limite_rojo,
               actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
        [c.indicador, base.nombre, base.unidad, c.verde, c.amarillo, c.rojo, base.sentido, actualizadoPor || null]
      );
    }
    // las metas van a Caja ANTES de confirmar: si Caja las rechaza (400) o no responde (502) se deshacen tambien los limites
    if (hayMetas && metasCajasEntrada.length) await metasCaja.guardarMetasMensuales({ metas: metasCajasEntrada, token });
  });
  return configuracion({ token });
}

module.exports = { INDICADORES, colorSegun, limitesPorDefecto, listarObjetivos, limitesDe, colorDe, validarIndicadores, validarIndicador, errorDeLimite, configuracion, guardarObjetivos };
