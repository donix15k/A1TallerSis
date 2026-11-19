// TDSI-125: Monitor de integraciones. Reune en un solo lugar los mensajes que cada microservicio envia a otros grupos
// (Contabilidad D, Compras C, Marketplace E) para que el administrador vea si todo llego.
const { fuentes, ESTADOS } = require("./integraciones/fuentes");
const { AppError } = require("../utils/AppError");

const GRUPOS = ["C", "D", "E"];
const POR_PAGINA_DEFECTO = 20;
const POR_PAGINA_MAX = 100;
const vacio = (v) => v === undefined || v === null || String(v).trim() === "";

/** Dia YYYY-MM-DD real (hora de Bolivia): inclusivo, "hasta" cuenta el dia completo. */
function validarDia(valor, nombre) {
  if (vacio(valor)) return null;
  const v = String(valor).trim();
  const f = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
  if (!f || Number.isNaN(f.getTime()) || f.toISOString().slice(0, 10) !== v) throw new AppError(`"${nombre}" debe ser una fecha válida con formato AAAA-MM-DD.`, 400, { [nombre]: valor });
  return v;
}
const diaBolivia = (fecha) => new Date(fecha).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });

/** Valida los filtros del monitor: grupo (C, D o E), estado, rango de fechas y pagina. */
function validarFiltros({ grupo, estado, desde, hasta, pagina, por_pagina } = {}) {
  let g = null;
  if (!vacio(grupo)) {
    g = String(grupo).trim().toUpperCase();
    if (!GRUPOS.includes(g)) throw new AppError(`El grupo debe ser uno de: ${GRUPOS.join(", ")}.`, 400, { grupo });
  }
  let e = null;
  if (!vacio(estado)) {
    e = ESTADOS.find((x) => x.toLowerCase() === String(estado).trim().toLowerCase());
    if (!e) throw new AppError(`El estado debe ser uno de: ${ESTADOS.join(", ")}.`, 400, { estado });
  }
  const d = validarDia(desde, "desde");
  const h = validarDia(hasta, "hasta");
  if (d && h && d > h) throw new AppError('"desde" no puede ser posterior a "hasta".', 400, { desde: d, hasta: h });
  let p = 1;
  if (!vacio(pagina)) {
    p = Number(pagina);
    if (!Number.isInteger(p) || p < 1) throw new AppError("La página debe ser un número entero mayor o igual a 1.", 400, { pagina });
  }
  let pp = POR_PAGINA_DEFECTO;
  if (!vacio(por_pagina)) {
    pp = Number(por_pagina);
    if (!Number.isInteger(pp) || pp < 1 || pp > POR_PAGINA_MAX) throw new AppError(`"por_pagina" debe ser un entero entre 1 y ${POR_PAGINA_MAX}.`, 400, { por_pagina });
  }
  return { grupo: g, estado: e, desde: d, hasta: h, pagina: p, por_pagina: pp };
}

/**
 * TDSI-126: pide los envios a TODOS los microservicios en paralelo. Si uno no responde, el monitor igual muestra lo de los
 * demas y avisa cual fallo en `fuentes` ({ origen, ok, total, error }): un servicio caido no deja ciega a la pantalla.
 * Devuelve { mensajes, fuentes } con los mensajes del mas reciente al mas viejo.
 */
async function reunirMensajes({ token = null } = {}) {
  const lista = fuentes();
  const resultados = await Promise.allSettled(lista.map((f) => f.listar({ token })));
  const mensajes = [];
  const estadoFuentes = resultados.map((r, i) => {
    if (r.status === "fulfilled") {
      mensajes.push(...r.value);
      return { origen: lista[i].origen, ok: true, total: r.value.length };
    }
    return { origen: lista[i].origen, ok: false, total: 0, error: r.reason?.message || "error desconocido" };
  });
  mensajes.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
  return { mensajes, fuentes: estadoFuentes };
}

/**
 * TDSI-126/127: los mensajes de los cinco microservicios con filtros (grupo C, D o E; estado; rango de fechas, dias de Bolivia
 * inclusivos) y paginacion de 20 en 20 (?pagina=N&por_pagina=M, maximo 100). "total" es el conteo con esos filtros.
 */
async function listarMensajes({ token = null, ...consulta } = {}) {
  const f = validarFiltros(consulta);
  const { mensajes, fuentes: estadoFuentes } = await reunirMensajes({ token });

  const filtrados = mensajes.filter((m) => {
    if (f.grupo && m.grupo !== f.grupo) return false;
    if (f.estado && m.estado !== f.estado) return false;
    if (f.desde || f.hasta) {
      if (!m.fecha) return false; // sin fecha no se puede ubicar en un rango
      const dia = diaBolivia(m.fecha);
      if (f.desde && dia < f.desde) return false;
      if (f.hasta && dia > f.hasta) return false;
    }
    return true;
  });
  const inicio = (f.pagina - 1) * f.por_pagina;
  return {
    total: filtrados.length,
    pagina: f.pagina,
    por_pagina: f.por_pagina,
    total_paginas: Math.max(1, Math.ceil(filtrados.length / f.por_pagina)),
    fuentes: estadoFuentes,
    data: filtrados.slice(inicio, inicio + f.por_pagina),
  };
}

module.exports = { reunirMensajes, listarMensajes, validarFiltros, GRUPOS };
