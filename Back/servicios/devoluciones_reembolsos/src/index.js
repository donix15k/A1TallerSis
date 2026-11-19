const app = require("./app");
const reversiones = require("./jobs/reversionesPasarela");
const valesExpirados = require("./jobs/valesExpirados");
const reintentoContabilidad = require("./jobs/reintentoEnviosContabilidad");
const respuestasContabilidad = require("./jobs/respuestasContabilidad");
const solicitudesMarketplace = require("./jobs/solicitudesMarketplace");

const port = process.env.PORT || 4007;

app.listen(port, () => {
  console.log(`Microservicio de Devoluciones y Reembolsos corriendo en el puerto ${port}`);
  // Reversiones de tarjeta/QR pendientes: se envian a la pasarela y se reintentan (0 = desactivado).
  const cadaSeg = Number(process.env.PASARELA_JOB_INTERVALO_SEG ?? 30);
  if (cadaSeg > 0) reversiones.iniciar({ intervaloMs: cadaSeg * 1000 });
  // Vales vencidos: tarea diaria que los marca EXPIRADO (0 = desactivada).
  const cadaHoras = Number(process.env.VALES_JOB_INTERVALO_HORAS ?? 24);
  if (cadaHoras > 0) valesExpirados.iniciar({ intervaloMs: cadaHoras * 3600 * 1000 });
  // Notas de credito para Contabilidad (Pub/Sub): reintenta los envios pendientes (solo si hay topico configurado).
  reintentoContabilidad.iniciar();
  // ...y lee las respuestas de Contabilidad (N° de asiento o rechazo) en nuestra suscripcion.
  respuestasContabilidad.iniciar();
  // Solicitudes de devolucion del Marketplace (SOLICITUD_DEVOLUCION): cada 30 s se registran como devoluciones PENDIENTES.
  solicitudesMarketplace.iniciar();
});
