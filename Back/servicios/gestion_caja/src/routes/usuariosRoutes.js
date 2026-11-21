const { Router } = require("express");
const { crearCajero, listarUsuarios, editarUsuario, cambiarPasswordCajero, cambiarEstadoUsuario, crearAdministrador, crearSupervisor, restablecerCredencial } = require("../services/adminUsuariosService");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// TDSI-47/916: lista de cajeros y supervisores para la pantalla "Usuarios".
router.get("/", wrap(async (req, res) => {
  const data = await listarUsuarios();
  res.json({ ok: true, data });
}));

// TDSI-47/171: el Administrador registra un cajero nuevo (usuario/contrasena).
router.post("/cajeros", wrap(async (req, res) => {
  const cajero = await crearCajero(req.body);
  res.status(201).json({ ok: true, mensaje: "Cajero registrado.", data: cajero });
}));

// "Usuarios y accesos": crear un administrador (correo, contrasena de 8+ caracteres, nombre y datos personales opcionales).
router.post("/administradores", wrap(async (req, res) => {
  const admin = await crearAdministrador(req.body);
  res.status(201).json({ ok: true, mensaje: "Administrador registrado.", data: admin });
}));

// "Usuarios y accesos": crear un supervisor de caja (usuario, nombre y PIN de 4 a 6 digitos), que se guarda en Facturacion.
router.post("/supervisores", wrap(async (req, res) => {
  const supervisor = await crearSupervisor(req.body);
  res.status(201).json({ ok: true, mensaje: "Supervisor registrado.", data: supervisor });
}));

// "Restablecer contrasena / PIN" de cualquier usuario: { password } para cajeros y administradores, { pin } para supervisores.
router.put("/:id/restablecer", wrap(async (req, res) => {
  const usuario = await restablecerCredencial(req.params.id, req.body);
  res.json({ ok: true, mensaje: "Credencial restablecida.", data: usuario });
}));

// TDSI-47/917: "Editar" -- cambia nombre y usuario de un cajero o un supervisor.
router.put("/:id", wrap(async (req, res) => {
  const usuario = await editarUsuario(req.params.id, req.body);
  res.json({ ok: true, data: usuario });
}));

// TDSI-47/917: "Cambiar contrasena" -- solo para cajeros.
router.put("/cajeros/:id/password", wrap(async (req, res) => {
  const cajero = await cambiarPasswordCajero(req.params.id, req.body);
  res.json({ ok: true, mensaje: "Contrasena actualizada.", data: cajero });
}));

// TDSI-47/918: "Activar" / "Desactivar" un cajero o un supervisor.
router.patch("/:id/estado", wrap(async (req, res) => {
  const usuario = await cambiarEstadoUsuario(req.params.id, req.body, { solicitante_id: req.administrador?.administrador_id });
  res.json({ ok: true, data: usuario });
}));

module.exports = router;
