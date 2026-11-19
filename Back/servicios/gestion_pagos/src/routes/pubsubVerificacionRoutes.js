const { Router } = require("express");
const { enviarVerificacion, listarVerificaciones, listarGrupos } = require("../services/pubsubVerificacionService");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// TDSI-958: pantalla "Verificación de Pub/Sub" del Administrador -- mandar un mensaje
// cualquiera a cualquiera de los tópicos de los grupos del proyecto compartido, para
// saber con quién hay conexión real y con quién no.

// Lista fija de grupos/tópicos para armar el selector del Front.
router.get("/pubsub-verificacion/grupos", wrap(async (req, res) => {
  res.json({ ok: true, data: listarGrupos() });
}));

// Las últimas verificaciones (el "log" de la pantalla), más reciente primero.
router.get("/pubsub-verificacion", wrap(async (req, res) => {
  const data = await listarVerificaciones();
  res.json({ ok: true, data });
}));

// Manda `mensaje` simulando que viene de `grupo_origen` (A por defecto, el real) al
// tópico de `grupo`, o a `topico_personalizado` si se indica uno (para probar un
// tópico fuera de los grupos conocidos, TDSI-962), y deja constancia de si llegó o no.
// 400 si falta el mensaje, o si el grupo origen/destino (o el tópico personalizado) no son válidos.
router.post("/pubsub-verificacion", wrap(async (req, res) => {
  const data = await enviarVerificacion({
    grupo_origen: req.body.grupo_origen,
    grupo: req.body.grupo,
    topico_personalizado: req.body.topico_personalizado,
    mensaje: req.body.mensaje,
    enviado_por: req.body.enviado_por,
  });
  res.json({ ok: true, data });
}));

module.exports = router;
