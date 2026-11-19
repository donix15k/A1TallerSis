// TDSI-182: las 3 tarjetas de estado de la pestaña "Integraciones y proveedores" del Panel de KPIs (Contabilidad, Compras / Proveedores
// y Marketplace). Se arman con los mensajes del Monitor y con los KPIs que calculan los microservicios duenos (por HTTP, reenviando el
// token del administrador). Si un servicio no responde, su tarjeta lo dice ({ disponible: false, error }) y las demas siguen.
const { query } = require("../../config/db");

const { aceptacionContable, diasPagoProveedores } = require("../kpiExternos");
const diaBolivia = (fecha) => new Date(fecha).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });

/** Compras y Marketplace: VERDE sin errores ni reintentos, AMARILLO con mensajes en reintento (Pendiente), ROJO con mensajes en Error. */
function colorEstado({ errores, reintentos }) {
  if (errores > 0) return "ROJO";
  if (reintentos > 0) return "AMARILLO";
  return "VERDE";
}

/** Cuenta los mensajes de un grupo dentro del periodo (hora de Bolivia) por estado; sin fecha no se puede ubicar en el mes. */
function contarGrupo(mensajes, grupo, rango) {
  const delGrupo = mensajes.filter((m) => m.grupo === grupo);
  const delPeriodo = delGrupo.filter((m) => {
    if (!m.fecha) return false;
    const dia = diaBolivia(m.fecha);
    return dia >= rango.desde && dia <= rango.hasta;
  });
  const ultimo = delGrupo.reduce((a, m) => (m.fecha && (!a || new Date(m.fecha) > new Date(a)) ? m.fecha : a), null);
  return {
    mensajes: delPeriodo.length,
    errores: delPeriodo.filter((m) => m.estado === "Error").length,
    reintentos: delPeriodo.filter((m) => m.estado === "Pendiente").length,
    ultimo_mensaje_en: ultimo ? new Date(ultimo).toISOString() : null,
  };
}

const masReciente = (a, b) => (!a ? b : !b ? a : new Date(a) >= new Date(b) ? a : b);

async function tarjetaContabilidad({ periodo, token }) {
  const { datos, error } = await aceptacionContable({ periodo, token, limite: 1 });
  if (!datos) return { disponible: false, error, porcentaje: null, color: null, registrados: null, enviados: null, rechazados: null };
  return { disponible: true, error: null, porcentaje: datos.porcentaje, color: datos.color, registrados: datos.registrados, enviados: datos.enviados, rechazados: datos.rechazados, sin_respuesta: datos.sin_respuesta, incompleto: datos.incompleto, sin_asientos: datos.sin_asientos };
}

async function tarjetaCompras({ periodo, token, mensajes, rango }) {
  const estado = contarGrupo(mensajes, "C", rango);
  const { datos, error } = await diasPagoProveedores({ periodo, token, limite: 1 });
  return {
    disponible: Boolean(datos),
    error,
    ordenes_recibidas: datos ? datos.ordenes_recibidas : null,
    ultimo_mensaje_en: masReciente(estado.ultimo_mensaje_en, datos?.ultima_orden_recibida_en ? new Date(datos.ultima_orden_recibida_en).toISOString() : null),
    mensajes_en_reintento: estado.reintentos,
    mensajes_en_error: estado.errores,
    color: colorEstado(estado),
  };
}

async function tarjetaMarketplace({ mensajes, rango }) {
  const estado = contarGrupo(mensajes, "E", rango);
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total FROM pagos.ventas_online WHERE (recibida_en AT TIME ZONE 'America/La_Paz')::date BETWEEN $1::date AND $2::date`,
    [rango.desde, rango.hasta]
  );
  return {
    disponible: true,
    error: null,
    pedidos_sincronizados: rows[0].total,
    ultimo_mensaje_en: estado.ultimo_mensaje_en,
    mensajes_en_reintento: estado.reintentos,
    mensajes_en_error: estado.errores,
    color: colorEstado(estado),
  };
}

/** { contabilidad, compras, marketplace } del periodo (rango = { periodo, desde, hasta }). */
async function construirTarjetas({ rango, mensajes, token }) {
  const [contabilidad, compras, marketplace] = await Promise.all([
    tarjetaContabilidad({ periodo: rango.periodo, token }),
    tarjetaCompras({ periodo: rango.periodo, token, mensajes, rango }),
    tarjetaMarketplace({ mensajes, rango }),
  ]);
  return { contabilidad, compras, marketplace };
}

module.exports = { construirTarjetas, colorEstado, contarGrupo };
