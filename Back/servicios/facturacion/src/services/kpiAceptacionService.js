const { query } = require("../config/db");
const { rangoDelPeriodo, ZONA } = require("../utils/periodo");
const { asientosNotasCredito, asientosDiferenciasCaja } = require("./asientosProxy");
const { limitesDe, colorSegun, INICIALES } = require("./objetivosProxy");

// TDSI-179: KPI 6 · Aceptacion contable. VERDE >= 98 %, AMARILLO 95 - 97,9 %, ROJO < 95 %.
const UMBRALES_ACEPTACION = { verde: 98, amarillo: 95 };
const LIMITE_POR_DEFECTO = 50;
const LIMITE_MAXIMO = 200;

const aCentavos = (n) => Math.round(Number(n) * 100);
const porcentaje = (parte, total) => (total > 0 ? Math.round((parte / total) * 10000) / 100 : 0);

/** VERDE desde 98 %, AMARILLO desde 95 % (hasta 97,99 %), ROJO por debajo de 95 % (o los limites vigentes que se pasen: TDSI-191). */
function colorAceptacion(pct, limites = INICIALES.aceptacion_contable) {
  return colorSegun(pct, limites);
}

function validarLimite(valor) {
  if (valor === undefined || valor === null || valor === "") return LIMITE_POR_DEFECTO;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > LIMITE_MAXIMO) {
    const e = new Error(`'limite' debe ser un entero entre 1 y ${LIMITE_MAXIMO}.`);
    e.status = 400;
    e.detalle = { limite: valor };
    throw e;
  }
  return n;
}

/**
 * Los asientos de FACTURAS (venta y anulacion) enviados a Contabilidad en el periodo (hora de Bolivia, por la fecha de envio).
 * registrados = Contabilidad contesto "aceptado" (o "registrado"); rechazados = "rechazado" (con su motivo); sin_respuesta = enviados
 * que todavia no tienen respuesta (NO cuentan como rechazados).
 */
async function asientosDeFacturas(rango) {
  const { rows } = await query(
    `SELECT e.id, e.tipo, f.numero, e.resultado, e.resultado_motivo, e.enviado_en
       FROM facturacion.factura_envios_contabilidad e
       JOIN facturacion.facturas f ON f.id = e.factura_id
      WHERE e.estado = 'Enviado' AND e.enviado_en IS NOT NULL
        AND (e.enviado_en AT TIME ZONE '${ZONA}')::date BETWEEN $1::date AND $2::date
      ORDER BY e.enviado_en DESC, e.id DESC`,
    [rango.desde, rango.hasta]
  );
  const resultado = (r) => String(r.resultado ?? "").trim().toLowerCase();
  const registrados = rows.filter((r) => ["aceptado", "registrado"].includes(resultado(r))).length;
  const rechazadas = rows.filter((r) => resultado(r) === "rechazado");
  return {
    enviados: rows.length,
    registrados,
    rechazados: rechazadas.length,
    sin_respuesta: rows.length - registrados - rechazadas.length,
    rechazados_lista: rechazadas.map((r) => ({
      id: String(r.id),
      referencia: r.tipo === "anulacion" ? `ANU-${r.numero}` : r.numero,
      tipo: r.tipo === "anulacion" ? "FACTURA_ANULACION" : "FACTURA_VENTA",
      motivo: r.resultado_motivo || "Sin motivo informado",
      enviado_en: r.enviado_en,
    })),
  };
}

const conteo = (d) => ({ enviados: d.enviados, registrados: d.registrados, rechazados: d.rechazados, sin_respuesta: d.sin_respuesta });
const vacio = () => ({ enviados: 0, registrados: 0, rechazados: 0, sin_respuesta: 0, rechazados_lista: [] });

/**
 * TDSI-179/180: KPI 6 · Aceptacion contable del mes = asientos registrados / asientos enviados x 100, con los asientos de FACTURAS
 * (los de esta base), de NOTAS DE CREDITO (Devoluciones) y de DIFERENCIAS DE CAJA (Gestion de Caja) sumados.
 *  - Los asientos sin respuesta todavia cuentan como enviados pero NO como rechazados.
 *  - Sin asientos enviados no hay porcentaje: porcentaje y color null (sin_asientos).
 *  - Si Devoluciones o Caja no responden, su parte queda { disponible: false, error } y NO entra a la suma; "incompleto" avisa que
 *    el porcentaje no incluye todas las fuentes.
 *  - rechazados_lista: todos los rechazados (origen, id, referencia, motivo), el mas reciente primero (?limite=, 50 por defecto,
 *    maximo 200); "origen" + "id" sirven para reenviarlos con el Monitor de integraciones.
 */
async function aceptacionContable({ periodo, token, limite, ahora } = {}) {
  const rango = rangoDelPeriodo(periodo, { ahora });
  const tope = validarLimite(limite);
  const limites = await limitesDe("aceptacion_contable", { token });
  const [facturas, nc, dif] = await Promise.all([
    asientosDeFacturas(rango),
    asientosNotasCredito({ periodo: rango.periodo, token }),
    asientosDiferenciasCaja({ periodo: rango.periodo, token }),
  ]);

  const fuentes = [
    { clave: "facturas", origen: "facturacion", datos: facturas, error: null },
    { clave: "notas_credito", origen: "devoluciones", datos: nc.datos, error: nc.error },
    { clave: "diferencias_caja", origen: "gestion_caja", datos: dif.datos, error: dif.error },
  ];
  const disponibles = fuentes.filter((f) => f.datos);
  const suma = disponibles.reduce((a, f) => ({ enviados: a.enviados + f.datos.enviados, registrados: a.registrados + f.datos.registrados, rechazados: a.rechazados + f.datos.rechazados, sin_respuesta: a.sin_respuesta + f.datos.sin_respuesta }), { enviados: 0, registrados: 0, rechazados: 0, sin_respuesta: 0 });
  const pct = suma.enviados > 0 ? porcentaje(suma.registrados, suma.enviados) : null;

  const lista = disponibles
    .flatMap((f) => (f.datos.rechazados_lista || vacio().rechazados_lista).map((r) => ({ origen: f.origen, ...r })))
    .sort((a, b) => new Date(b.enviado_en) - new Date(a.enviado_en));

  return {
    ...rango,
    ...suma,
    porcentaje: pct,
    color: pct === null ? null : colorAceptacion(pct, limites),
    sin_asientos: suma.enviados === 0,
    incompleto: disponibles.length < fuentes.length,
    por_tipo: Object.fromEntries(fuentes.map((f) => [f.clave, f.datos ? { disponible: true, ...conteo(f.datos) } : { disponible: false, error: f.error, ...conteo(vacio()) }])),
    rechazados_total: suma.rechazados,
    rechazados_lista: lista.slice(0, tope),
    umbrales: { verde: limites.verde, amarillo: limites.amarillo },
  };
}

module.exports = { aceptacionContable, colorAceptacion, UMBRALES_ACEPTACION };
