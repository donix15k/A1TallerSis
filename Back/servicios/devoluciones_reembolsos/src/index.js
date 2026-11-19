require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { errorHandler } = require("./middlewares/errorHandler");

const app = express();
const port = process.env.PORT || 4007;

// Permite que el Frontend (Vite en localhost:5173, u otro origen en produccion) consuma este servicio.
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true, servicio: "devoluciones_reembolsos" });
});

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Microservicio de Devoluciones y Reembolsos corriendo en el puerto ${port}`);
});
