const { Router } = require("express");
const { resolverDiferencia, listarDiferencias, reenviarContabilidad } = require("../services/diferenciasService");

const { requireAdministrador } = require("../middlewares/requireAdministrador");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// TDSI-52/701: "Diferencias de caja" del Administrador, con el estado del aviso a
// Contabilidad (columna "Contabilidad" del Front). ?estado=PENDIENTE|RESUELTA opcional.
router.get("/diferencias", wrap(async (req, res) => {
  const data = await listarDiferencias({ estado: req.query.estado });
  res.json({ ok: true, data });
}));

// TDSI-52/698: el Administrador resuelve una diferencia con su justificacion; el
// sistema publica el aviso a Contabilidad (DIF-<id>) y devuelve si se pudo enviar.
// Lee ahora mismo las respuestas de Contabilidad de la suscripcion de A1, sin esperar el reloj de 30 s. Solo administrador.
router.post("/diferencias/respuestas-contabilidad/procesar", requireAdministrador, wrap(async (req, res) => {
  const r = await require("../jobs/respuestasContabilidad").procesarRespuestas();
  res.json({ ok: true, procesadas: r.length });
}));

router.post("/diferencias/:id/resolver", wrap(async (req, res) => {
  const data = await resolverDiferencia(req.params.id, req.body);
  res.json({ ok: true, mensaje: "Diferencia resuelta", data });
}));

// TDSI-52/701/964: boton "Reenviar" -- solo si el aviso anterior no se pudo publicar o
// Contabilidad lo rechazo. grupo_origen (opcional) simula un envio desde otro grupo del
// proyecto, igual que en "Verificación de Pub/Sub"; el destino siempre es Contabilidad.
router.post("/diferencias/:id/reenviar-contabilidad", wrap(async (req, res) => {
  const cuerpo = req.body || {};
  const data = await reenviarContabilidad(req.params.id, {
    grupoOrigen: cuerpo.grupo_origen,
    enviadoPor: cuerpo.enviado_por,
    justificacion: cuerpo.justificacion,
  });
  res.json({ ok: true, mensaje: "Reenviado a Contabilidad", data });
}));

module.exports = router;
