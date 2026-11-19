const repo = require("../data/enviosComprasRepo");

// Nuestro identificador en el aviso a Compras: el codigo de la devolucion, "DEV-0042"
const REFERENCIA = /^DEV-\d{1,10}$/;
const ACUSES = ["RECIBIDO", "RECLAMO_REGISTRADO"];

const texto = (v) => (v === undefined || v === null ? "" : String(v).trim());

/**
 * TDSI-105: interpreta un mensaje de la suscripcion del Grupo A1. Devuelve null si no es un acuse de Compras a un aviso de
 * devolucion nuestro (referencia DEV-NNNN) con estado RECIBIDO o RECLAMO_REGISTRADO. Se tolera que Compras nombre el campo
 * de la referencia (codigo_devolucion / referencia_externa / reporte_id) y del reclamo (numero_reclamo / reclamo_id) distinto.
 *   { referencia, codigo, acuse, numeroReclamo }
 */
function interpretar(cuerpo) {
  let r;
  try {
    r = JSON.parse(cuerpo);
  } catch {
    return null;
  }
  if (!r || typeof r !== "object") return null;
  const origen = texto(r.origen || r.sistema_origen).toUpperCase();
  if (origen !== "COMPRAS" && !/COMPRAS/.test(origen)) return null;

  const referencia = [r.codigo_devolucion, r.referencia_externa, r.reporte_id, r.devolucion].map(texto).find((v) => REFERENCIA.test(v.toUpperCase()));
  if (!referencia) return null;
  const acuse = texto(r.estado || r.acuse || r.resultado).toUpperCase().replace(/\s+/g, "_");
  if (!ACUSES.includes(acuse)) return null;
  const reclamo = texto(r.numero_reclamo ?? r.reclamo_id ?? r.nro_reclamo).slice(0, 40);
  return { referencia: referencia.toUpperCase(), codigo: referencia.toUpperCase(), acuse, numeroReclamo: reclamo || null };
}

/**
 * Guarda el acuse en el aviso de esa devolucion: RECIBIDO -> estado Recibido; RECLAMO_REGISTRADO -> Recibido con el N° de
 * reclamo. propio = true solo si el mensaje corresponde a un aviso nuestro: esos se confirman (ack); el resto se libera
 * para quien mas lea la suscripcion (por ejemplo Gestion de Pagos, que recibe los acuses de sus reportes PV-).
 */
async function procesarMensaje({ texto: cuerpo, messageId }) {
  const datos = interpretar(cuerpo);
  if (!datos) return { propio: false };
  const envio = await repo.registrarAcuse({ ...datos, messageId });
  return { propio: Boolean(envio), referencia: datos.referencia, resultado: datos.acuse, envio };
}

module.exports = { interpretar, procesarMensaje, ACUSES };
