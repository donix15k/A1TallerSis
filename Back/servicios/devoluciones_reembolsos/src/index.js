const app = require("./app");
const reversiones = require("./jobs/reversionesPasarela");

const port = process.env.PORT || 4007;

app.listen(port, () => {
  console.log(`Microservicio de Devoluciones y Reembolsos corriendo en el puerto ${port}`);
  // Reversiones de tarjeta/QR pendientes: se envian a la pasarela y se reintentan (0 = desactivado).
  const cadaSeg = Number(process.env.PASARELA_JOB_INTERVALO_SEG ?? 30);
  if (cadaSeg > 0) reversiones.iniciar({ intervaloMs: cadaSeg * 1000 });
});
