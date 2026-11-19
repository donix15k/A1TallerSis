// TDSI-48: envio de las reversiones de tarjeta/QR a la pasarela, con reintentos.
const repo = require("../data/reembolsosRepo");
const { enviarReversion } = require("./pasarelaClient");

const maxIntentos = () => Number(process.env.PASARELA_MAX_INTENTOS) || 5;
const esperaBaseSeg = () => Number(process.env.PASARELA_ESPERA_SEG) || 30;
/** Espera antes del proximo intento: crece al doble en cada fallo (30 s, 60 s, 120 s, ...), con tope de 1 hora. */
const esperaTras = (intentos) => Math.min(esperaBaseSeg() * 2 ** (intentos - 1), 3600);

/**
 * Intenta enviar los envios PENDIENTES cuyo reintento ya toca. Cada envio se toma con un candado de fila
 * (SKIP LOCKED) dentro de su propia transaccion, asi dos procesos nunca envian el mismo dos veces.
 *  - la pasarela acepta -> envio ENVIADO + reembolso PROCESADO
 *  - falla -> se guarda el error y la hora del proximo intento; al agotar PASARELA_MAX_INTENTOS queda en ERROR
 * Con `reembolsoIds` solo procesa esos reembolsos. Devuelve { enviados, fallidos, agotados }.
 */
async function procesarPendientes({ limite = 20, reembolsoIds = null } = {}) {
  const resumen = { enviados: 0, fallidos: 0, agotados: 0 };
  // Un envio por transaccion: un fallo en uno no deshace lo ya enviado de los otros.
  const ids = await repo.idsPendientes({ limite, reembolsoIds });

  for (const id of ids) {
    await repo.withTransaction(async (client) => {
      const envio = await repo.tomarEnvio(client, id);
      if (!envio) return;
      try {
        await enviarReversion({ tipo: envio.tipo, monto: envio.monto, codigo: envio.devolucion_codigo, reembolsoId: envio.reembolso_id });
        await repo.marcarEnviado(client, envio);
        resumen.enviados++;
      } catch (e) {
        const agotado = await repo.registrarFallo(client, envio, e.message, { maxIntentos: maxIntentos(), esperaSegundos: esperaTras(envio.intentos + 1) });
        resumen.fallidos++;
        if (agotado) resumen.agotados++;
      }
    });
  }
  return resumen;
}

module.exports = { procesarPendientes, esperaTras };
