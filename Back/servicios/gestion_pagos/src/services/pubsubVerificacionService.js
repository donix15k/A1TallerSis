const { publicar } = require("../clients/pubsubPublisher");
const repo = require("../data/pubsubVerificacionesRepo");
const { GRUPOS, buscarPorGrupo, slugificarOrigen, fechaDocumentoHoy } = require("../config/pubsubGrupos");
const { AppError } = require("../utils/AppError");

const LARGO_MAXIMO_MENSAJE = 2000;

// TDSI-962: para probar un topico que NO es ninguno de los grupos conocidos (A a I, A1 y A2) (uno
// de prueba propio, o incluso de otro proyecto de GCP) -- asi se puede distinguir si
// un envio que falla es porque el topico/proyecto esta mal, o porque es nuestro codigo.
const TOPICO_REGEX = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][\w.~+%-]{2,254}$/;

function validarTopicoPersonalizado(valor) {
  const texto = String(valor || "").trim();
  if (!TOPICO_REGEX.test(texto)) {
    throw new AppError("El tópico personalizado debe tener la forma projects/<proyecto>/topics/<topico>.", 400, { topico: valor });
  }
  return texto;
}

/**
 * TDSI-958/960/961/962/963: manda `mensaje` (texto libre) desde el `grupo_origen`
 * elegido (por defecto A, que es quien de verdad somos) al topico del `grupo` elegido
 * (o a `topico_personalizado` si se indica uno, para probar un topico fuera de los 9
 * grupos conocidos), siempre envuelto en el MISMO sobre que ya usan nuestras
 * integraciones reales con Contabilidad (sistema_origen/referencia_externa/
 * tipo_operacion/fecha_documento/datos -- ver facturacion/src/services/
 * contabilidadService.js y gestion_caja/src/services/contabilidadService.js). Deja
 * constancia del resultado (llego o no) -- asi el Administrador puede probar, uno por
 * uno, con cuales de los otros grupos del proyecto hay conexion real, simulando
 * tambien que el mensaje venga de cualquiera de los otros grupos si hace falta.
 */
async function enviarVerificacion({ grupo_origen, grupo, topico_personalizado, mensaje, enviado_por }) {
  const origen = buscarPorGrupo(grupo_origen || "A");
  if (!origen) {
    throw new AppError(`El grupo origen debe ser uno de: ${GRUPOS.map((g) => g.grupo).join(", ")}.`, 400, { grupo_origen });
  }

  let destino;
  if (topico_personalizado && String(topico_personalizado).trim()) {
    destino = { grupo: "CUSTOM", nombre: "Tópico personalizado", topico: validarTopicoPersonalizado(topico_personalizado) };
  } else {
    destino = buscarPorGrupo(grupo);
    if (!destino) {
      throw new AppError(`El grupo debe ser uno de: ${GRUPOS.map((g) => g.grupo).join(", ")}.`, 400, { grupo });
    }
  }

  const texto = String(mensaje ?? "").trim();
  if (!texto) throw new AppError("Escribe un mensaje para enviar.", 400);
  if (texto.length > LARGO_MAXIMO_MENSAJE) {
    throw new AppError(`El mensaje puede tener hasta ${LARGO_MAXIMO_MENSAJE} caracteres.`, 400);
  }

  const referenciaExterna = `VERIF-${Date.now()}`;
  const payload = {
    sistema_origen: slugificarOrigen(origen.nombre),
    referencia_externa: referenciaExterna,
    tipo_operacion: "verificacion_manual",
    fecha_documento: fechaDocumentoHoy(),
    datos: {
      mensaje: texto,
      enviado_por_email: enviado_por || null,
    },
  };

  const resultado = await publicar(destino.topico, payload, {
    tipo: "VERIFICACION_MANUAL",
    tipo_operacion: "verificacion_manual",
    referencia_externa: referenciaExterna,
    origen: "gestion_pagos",
    grupo: origen.grupo,
  });

  return repo.registrar({
    grupo: destino.grupo,
    grupo_origen: origen.grupo,
    topico: destino.topico,
    mensaje: texto,
    payload_enviado: payload,
    ok: resultado.ok,
    message_id: resultado.ok ? resultado.messageId : null,
    error: resultado.ok ? null : resultado.error,
    enviado_por,
  });
}

function listarGrupos() {
  return GRUPOS.map(({ grupo, nombre, topico }) => ({ grupo, nombre, topico }));
}

async function listarVerificaciones() {
  return repo.listar(50);
}

module.exports = { enviarVerificacion, listarVerificaciones, listarGrupos };
