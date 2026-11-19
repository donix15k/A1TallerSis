// TDSI-93/106/117: cada 60 s reintenta los envios que no llegaron a publicarse: las notas de credito para Contabilidad (TDSI-93),
// los avisos de productos devueltos para Compras (TDSI-106) y el resultado de las devoluciones para el Marketplace (TDSI-117).
// Los envios que fallan por un problema pasajero (red, Pub/Sub caido) quedan "Pendiente" con la hora de su proximo intento;
// este proceso toma los que ya les toca y los vuelve a publicar con espera creciente (30 s, 60 s, 120 s, ...). Tras
// CONTABILIDAD_MAX_INTENTOS (5) intentos quedan en "Error" y el administrador los reenvia a mano (TDSI-95).
const contabilidadRepo = require("../data/enviosContabilidadRepo");
const comprasRepo = require("../data/enviosComprasRepo");
const contabilidad = require("../services/contabilidadService");
const compras = require("../services/comprasService");
const marketplaceRepo = require("../data/enviosMarketplaceRepo");
const marketplace = require("../services/marketplaceService");
const cfgMarketplace = require("../config/marketplace");
const cfg = require("../config/contabilidad");
const cfgCompras = require("../config/compras");

let enCurso = false;

// Cada destino con su configuracion, su repositorio y su forma de publicar.
const destinos = () => [
  { nombre: "contabilidad", activo: Boolean(cfg.PUBSUB_TOPIC), repo: contabilidadRepo, intentar: contabilidad.intentarEnvio, etiqueta: (r) => `la nota ${r.nota_numero}` },
  { nombre: "marketplace", activo: Boolean(cfgMarketplace.PUBSUB_TOPIC), repo: marketplaceRepo, intentar: marketplace.intentarEnvio, etiqueta: (r) => `el resultado de la devolucion ${r.devolucion_codigo}` },
  { nombre: "compras", activo: Boolean(cfgCompras.PUBSUB_TOPIC), repo: comprasRepo, intentar: compras.intentarEnvio, etiqueta: (r) => `la devolucion ${r.devolucion_codigo}` },
];

/**
 * Una pasada: toma los envios Pendientes cuya hora de reintento ya paso (SKIP LOCKED: dos procesos nunca toman el mismo)
 * e intenta publicarlos. Devuelve [{ destino, id, estado, intentos }] con lo que paso con cada uno.
 */
async function reintentarPendientes({ limite = 10 } = {}) {
  if (enCurso) return [];
  enCurso = true;
  const resultados = [];
  try {
    for (const d of destinos().filter((x) => x.activo)) {
      try {
        for (const envio of await d.repo.tomarPendientes(limite)) {
          try {
            const r = await d.intentar(envio);
            resultados.push({ destino: d.nombre, id: r.id, estado: r.estado, intentos: r.intentos });
            console.log(`[${d.nombre}] Reintento de ${d.etiqueta(r)}: ${r.estado} (intento ${r.intentos}/${cfg.MAX_INTENTOS})`);
          } catch (e) {
            // un fallo inesperado en uno no frena a los demas; queda con su proximo_intento_en y se retoma
            console.error(`[${d.nombre}] No se pudo reintentar el envio ${envio.id}:`, e.message);
          }
        }
      } catch (e) {
        console.error(`[${d.nombre}] No se pudieron tomar los envios pendientes:`, e.message);
      }
    }
  } finally {
    enCurso = false;
  }
  return resultados;
}

/** Arranca el proceso periodico. Devuelve una funcion para detenerlo. */
function iniciar({ intervaloSeg = cfg.INTERVALO_WORKER_SEG } = {}) {
  const activos = destinos().filter((d) => d.activo).map((d) => d.nombre);
  if (activos.length === 0) return () => {};
  const timer = setInterval(reintentarPendientes, intervaloSeg * 1000);
  timer.unref?.();
  console.log(`[reintentos] Reintentando envios pendientes (${activos.join(", ")}) cada ${intervaloSeg} s (hasta ${cfg.MAX_INTENTOS} intentos)`);
  return () => clearInterval(timer);
}

module.exports = { iniciar, reintentarPendientes };
