const { Router } = require("express");

const router = Router();

// TDSI-82: otros microservicios (Devoluciones) preguntan aqui si el Bearer token que reciben es de un Administrador
// activo, sin duplicar la logica de Supabase Auth. Va detras de requireAdministrador: si llega hasta aqui, lo es.
router.get("/verificar", (req, res) => {
  res.json({ ok: true, data: req.administrador });
});

// Perfil del administrador que inicio sesion (su nombre y datos personales) y cambio de su propia contrasena.
const { obtenerPerfil, actualizarPerfilPropio, cambiarPasswordPropia } = require("../services/adminUsuariosService");
const { verificarContrasena } = require("../services/authService");
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.get("/perfil", wrap(async (req, res) => {
  res.json({ ok: true, data: await obtenerPerfil(req.administrador.administrador_id) });
}));
router.put("/perfil", wrap(async (req, res) => {
  res.json({ ok: true, mensaje: "Perfil actualizado.", data: await actualizarPerfilPropio(req.administrador.administrador_id, req.body) });
}));
router.put("/perfil/password", wrap(async (req, res) => {
  await cambiarPasswordPropia(req.administrador.administrador_id, req.body, verificarContrasena);
  res.json({ ok: true, mensaje: "Contrasena actualizada." });
}));

module.exports = router;
