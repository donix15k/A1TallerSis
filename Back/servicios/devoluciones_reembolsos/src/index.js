const app = require("./app");

const port = process.env.PORT || 4007;

app.listen(port, () => {
  console.log(`Microservicio de Devoluciones y Reembolsos corriendo en el puerto ${port}`);
});
