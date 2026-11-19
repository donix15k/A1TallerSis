require("dotenv").config();
const express = require("express");
const cors = require("cors");
const devolucionesRoutes = require("./routes/devolucionesRoutes");
const valesRoutes = require("./routes/valesRoutes");
const { errorHandler } = require("./middlewares/errorHandler");
const { verificarEsquema } = require("./config/db");

const app = express();

// Permite que el Frontend (Vite en localhost:5173, u otro origen en produccion) consuma este servicio.
app.use(cors());
app.use(express.json());

app.get("/health", async (req, res) => {
  try {
    const { tablas } = await verificarEsquema();
    res.json({ ok: true, servicio: "devoluciones_reembolsos", db: "up", esquema_devoluciones: { tablas } });
  } catch (e) {
    res.status(503).json({ ok: false, servicio: "devoluciones_reembolsos", db: "down", mensaje: e.message });
  }
});

app.use("/api/devoluciones", devolucionesRoutes); // TDSI-12
app.use("/api/vales", valesRoutes); // TDSI-69

app.use(errorHandler);

module.exports = app;
