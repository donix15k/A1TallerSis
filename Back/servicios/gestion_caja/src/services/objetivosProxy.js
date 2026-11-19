// TDSI-191: los rangos del semaforo de cada KPI viven en pagos.kpi_objetivos (Gestion de Pagos) y se cambian en "Configurar objetivos".
// Este servicio los pide por HTTP (GET /api/kpis/objetivos, con el token del administrador) para pintar SUS colores con los mismos rangos.
// Si Gestion de Pagos no responde se usan los rangos iniciales del PDF: el panel nunca se queda sin color. Se guardan unos segundos para
// no pedirlos en cada consulta; un cambio de objetivos se ve en el panel en menos de ese tiempo.
const INICIALES = {
  cumplimiento_metas: { indicador: "cumplimiento_metas", verde: 100, amarillo: 70, rojo: 0, sentido: "MAYOR" },
  efectividad_cuadre: { indicador: "efectividad_cuadre", verde: 95, amarillo: 85, rojo: 0, sentido: "MAYOR" },
};
const TTL_MS = () => Number(process.env.OBJETIVOS_TTL_MS ?? 10000);
const timeoutMs = () => Number(process.env.OBJETIVOS_TIMEOUT_MS) || 3000;

let guardados = null; // { en, indicadores: Map }

function reiniciarCache() {
  guardados = null;
}

async function pedirObjetivos(token) {
  try {
    const r = await fetch(`${process.env.GESTION_PAGOS_URL || "http://localhost:4005"}/api/kpis/objetivos`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(timeoutMs()),
    });
    const cuerpo = await r.json().catch(() => null);
    if (r.status !== 200 || !Array.isArray(cuerpo?.data?.indicadores)) return null;
    return new Map(cuerpo.data.indicadores.map((i) => [i.indicador, i]));
  } catch {
    return null;
  }
}

/** Los limites vigentes de un indicador ({ verde, amarillo, rojo, sentido }); los iniciales si no se pueden consultar. */
async function limitesDe(indicador, { token } = {}) {
  const vigente = guardados && Date.now() - guardados.en < TTL_MS();
  if (!vigente) {
    const indicadores = await pedirObjetivos(token);
    guardados = indicadores ? { en: Date.now(), indicadores } : null; // lo que fallo no se guarda: se reintenta en la proxima consulta
    if (indicadores) return indicadores.get(indicador) || INICIALES[indicador];
    return INICIALES[indicador];
  }
  return guardados.indicadores.get(indicador) || INICIALES[indicador];
}

const aCentavos = (n) => Math.round(Number(n) * 100);

/** El color de un valor segun sus limites (MAYOR: mas es mejor; MENOR: menos es mejor). Sin dato, sin color. */
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

module.exports = { limitesDe, colorSegun, reiniciarCache, INICIALES };
