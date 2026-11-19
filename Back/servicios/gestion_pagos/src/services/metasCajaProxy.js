// TDSI-200/202: la meta MENSUAL de cada caja vive en Gestion de Caja (caja.metas_mensuales); "Configurar objetivos" las lee y las guarda
// por HTTP reenviando el token del administrador (nunca SQL cruzado).
const { AppError } = require("../utils/AppError");

const urlCaja = () => process.env.GESTION_CAJA_URL || "http://localhost:4004";
const timeoutMs = () => Number(process.env.CAJA_TIMEOUT_MS) || 5000;

async function llamar(metodo, cuerpo, token) {
  try {
    const r = await fetch(`${urlCaja()}/api/kpis/metas-mensuales`, {
      method: metodo,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(timeoutMs()),
    });
    return { status: r.status, cuerpo: await r.json().catch(() => null) };
  } catch (e) {
    const lenta = e.name === "TimeoutError" || e.name === "AbortError";
    return { status: 0, error: lenta ? "Gestión de Caja no respondió a tiempo" : "No se pudo conectar con Gestión de Caja" };
  }
}

/** La meta mensual de cada caja activa. Si Caja no responde: { cajas: [], error } (la ventana se abre igual, sin las metas). */
async function listarMetasMensuales({ token }) {
  const r = await llamar("GET", null, token);
  if (r.status === 200 && r.cuerpo?.data?.cajas) return { cajas: r.cuerpo.data.cajas, error: null };
  return { cajas: [], error: r.error || r.cuerpo?.mensaje || `Gestión de Caja respondió HTTP ${r.status}` };
}

/**
 * Guarda las metas mensuales en Caja (todas o ninguna). Una meta invalida es 400 con el campo de cada error (los que valida Caja:
 * caja inexistente o inactiva, meta <= 0...); si Caja no responde es 502 y NO se guarda nada.
 */
async function guardarMetasMensuales({ metas, token }) {
  const r = await llamar("PUT", { metas }, token);
  if (r.status === 200) return r.cuerpo?.data?.cajas || [];
  if (r.status === 400) throw new AppError(r.cuerpo?.mensaje || "Hay metas mensuales que no se pueden guardar.", 400, r.cuerpo?.detalle ?? null);
  if (r.status === 401 || r.status === 403) throw new AppError(r.cuerpo?.mensaje || "Gestión de Caja rechazó al administrador.", r.status);
  throw new AppError(`No se pudieron guardar las metas de las cajas: ${r.error || r.cuerpo?.mensaje || `Gestión de Caja respondió HTTP ${r.status}`}. No se guardó ningún cambio.`, 502);
}

module.exports = { listarMetasMensuales, guardarMetasMensuales };
