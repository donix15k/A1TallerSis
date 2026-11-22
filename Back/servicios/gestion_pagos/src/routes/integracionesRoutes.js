const { Router } = require("express");
const integraciones = require("../services/integracionesService");
const { requireAdministrador } = require("../middlewares/requireAdministrador");

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// Todo el Monitor de integraciones es solo del administrador (Bearer token validado contra Gestion de Caja).
router.use(requireAdministrador);

// TDSI-126/127: los mensajes enviados a otros grupos por todos los microservicios (grupo, tipo, fecha, estado y messageId),
// con filtros ?grupo=C|D|E, ?estado=, ?desde=, ?hasta= (AAAA-MM-DD, dia completo en Bolivia) y paginacion ?pagina=&por_pagina=.
router.get("/mensajes", wrap(async (req, res) => {
  const { total, pagina, por_pagina, total_paginas, fuentes, data } = await integraciones.listarMensajes({ ...req.query, token: req.tokenAdministrador });
  res.json({ ok: true, total, pagina, por_pagina, total_paginas, fuentes, data });
}));

// TDSI-128: totales por grupo (Compras, Marketplace, Contabilidad) y por estado (Enviado, Respondido, Pendiente, Error).
router.get("/resumen", wrap(async (req, res) => {
  res.json({ ok: true, data: await integraciones.resumen({ token: req.tokenAdministrador, periodo: req.query.periodo }) });
}));

// TDSI-129: boton "Reenviar" de los mensajes con Error: llama al reenvio del microservicio dueno del mensaje
// (origen: facturacion, gestion_caja, pagos_proveedores, devoluciones, gestion_pagos_compras o gestion_pagos_marketplace).
router.post("/mensajes/:origen/:id/reenviar", wrap(async (req, res) => {
  const data = await integraciones.reenviarMensaje({ origen: req.params.origen, id: req.params.id, token: req.tokenAdministrador, justificacion: req.body?.justificacion });
  res.json({ ok: true, mensaje: data.estado === "Error" ? "El reenvío volvió a fallar" : "Mensaje reenviado", data });
}));

module.exports = router;
