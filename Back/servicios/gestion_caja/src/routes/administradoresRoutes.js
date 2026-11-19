const { Router } = require("express");

const router = Router();

// TDSI-82: otros microservicios (Devoluciones) preguntan aqui si el Bearer token que reciben es de un Administrador
// activo, sin duplicar la logica de Supabase Auth. Va detras de requireAdministrador: si llega hasta aqui, lo es.
router.get("/verificar", (req, res) => {
  res.json({ ok: true, data: req.administrador });
});

module.exports = router;
