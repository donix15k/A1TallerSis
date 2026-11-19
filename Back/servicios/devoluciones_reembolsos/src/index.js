const app = require("./app");
const reversiones = require("./jobs/reversionesPasarela");
const valesExpirados = require("./jobs/valesExpirados");

const port = process.env.PORT || 4007;

app.listen(port, () => {
  console.log(`Microservicio de Devoluciones y Reembolsos corriendo en el puerto ${port}`);
  // Reversiones de tarjeta/QR pendientes: se envian a la pasarela y se reintentan (0 = desactivado).
  const cadaSeg = Number(process.env.PASARELA_JOB_INTERVALO_SEG ?? 30);
  if (cadaSeg > 0) reversiones.iniciar({ intervaloMs: cadaSeg * 1000 });
  // Vales vencidos: tarea diaria que los marca EXPIRADO (0 = desactivada).
  const cadaHoras = Number(process.env.VALES_JOB_INTERVALO_HORAS ?? 24);
  if (cadaHoras > 0) valesExpirados.iniciar({ intervaloMs: cadaHoras * 3600 * 1000 });
});
