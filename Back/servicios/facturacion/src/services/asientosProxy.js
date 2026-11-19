// TDSI-180: los asientos que Facturacion NO es duena (notas de credito de Devoluciones y diferencias de caja de Gestion de Caja) se
// piden por HTTP al servicio dueno (nunca SQL cruzado). Si uno no responde NO se cae el KPI: devuelve { datos: null, error }.
const urlDevoluciones = () => process.env.DEVOLUCIONES_URL || "http://localhost:4007";
const urlCaja = () => process.env.GESTION_CAJA_URL || "http://localhost:4004";
const timeoutMs = () => Number(process.env.INTEGRACIONES_TIMEOUT_MS) || 5000;

async function pedirAsientos(url, { periodo, token, nombre }) {
  try {
    const r = await fetch(`${url}/api/kpis/asientos-contables?periodo=${encodeURIComponent(periodo)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(timeoutMs()),
    });
    const cuerpo = await r.json().catch(() => null);
    if (r.status !== 200 || !cuerpo?.data) return { datos: null, error: cuerpo?.mensaje || `${nombre} respondió HTTP ${r.status}` };
    return { datos: cuerpo.data, error: null };
  } catch (e) {
    const lenta = e.name === "TimeoutError" || e.name === "AbortError";
    return { datos: null, error: lenta ? `${nombre} no respondió a tiempo` : `No se pudo conectar con ${nombre}` };
  }
}

const asientosNotasCredito = ({ periodo, token }) => pedirAsientos(urlDevoluciones(), { periodo, token, nombre: "Devoluciones" });
const asientosDiferenciasCaja = ({ periodo, token }) => pedirAsientos(urlCaja(), { periodo, token, nombre: "Gestión de Caja" });

module.exports = { asientosNotasCredito, asientosDiferenciasCaja };
