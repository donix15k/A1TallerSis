// Puente HTTP hacia el servicio de Facturacion (nunca por SQL cruzado entre servicios).
const { AppError } = require("../utils/AppError");
const { normalizarNumeroFactura } = require("../utils/numeroFactura");

const urlFacturacion = () => process.env.FACTURACION_URL || "http://localhost:4002";
const timeoutMs = () => Number(process.env.FACTURACION_TIMEOUT_MS) || 5000;

const aNumero = (valor) => Number(valor) || 0;

/** Un solo metodo -> su nombre; varios -> "Mixto" (mismo criterio que gestion_pagos); ninguno -> null. */
function metodoPagoDe(metodos) {
  if (metodos.length === 0) return null;
  return metodos.length === 1 ? metodos[0].metodo : "Mixto";
}

/**
 * TDSI-11: consulta GET {FACTURACION_URL}/api/facturas/:numero y devuelve la factura ya normalizada
 * (numeros como Number, no como texto): items, fecha, NIT del cliente, estado y metodo(s) de pago.
 *   - 404 de Facturacion  -> AppError 404 "No se encontró la factura"
 *   - Facturacion caida o sin responder a tiempo -> AppError 503
 *   - cualquier otro error de Facturacion -> AppError 502
 */
async function obtenerFactura(numero) {
  const numeroNormalizado = normalizarNumeroFactura(numero);

  let respuesta;
  try {
    respuesta = await fetch(`${urlFacturacion()}/api/facturas/${encodeURIComponent(numeroNormalizado)}`, {
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (e) {
    const sinRespuesta = e.name === "TimeoutError" || e.name === "AbortError";
    throw new AppError(
      sinRespuesta ? "Facturación no respondió a tiempo. Intente de nuevo." : "No se pudo conectar con Facturación. Intente de nuevo.",
      503,
      { causa: e.message }
    );
  }

  if (respuesta.status === 404) {
    throw new AppError("No se encontró la factura", 404, { numero: numeroNormalizado });
  }
  const cuerpo = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !cuerpo?.data) {
    throw new AppError(cuerpo?.mensaje || "Facturación devolvió una respuesta inesperada.", 502, { status: respuesta.status });
  }

  const f = cuerpo.data;
  const metodos = (f.metodosPago ?? []).map((m) => ({ metodo: m.metodo, monto: aNumero(m.monto) }));
  return {
    numero: f.numero,
    fecha: f.fecha,
    cliente_nit: f.cliente_nit ?? null,
    cliente_nombre: f.cliente_nombre ?? null,
    estado: f.estado,
    total: aNumero(f.total),
    items: (f.items ?? []).map((it) => ({
      descripcion: it.descripcion,
      cantidad: aNumero(it.cantidad),
      precio_unitario: aNumero(it.precio_unitario),
      subtotal: aNumero(it.subtotal),
    })),
    metodos_pago: metodos,
    metodo_pago: metodoPagoDe(metodos),
  };
}

/**
 * TDSI-34: valida el usuario + PIN de un supervisor llamando a POST {FACTURACION_URL}/api/supervisores/validar.
 * El registro de supervisores (con su PIN y el bloqueo tras intentos fallidos) vive en Facturacion y NUNCA se
 * duplica aqui: este servicio solo pregunta, y respeta lo que Facturacion responda.
 *   - correcto                       -> { supervisor_id, nombre }
 *   - usuario o PIN incorrecto (401) -> AppError 401 "Usuario o PIN incorrecto" (+ intentos_restantes)
 *   - supervisor bloqueado (423)     -> AppError 423 con el mensaje de Facturacion y bloqueado_hasta. No se
 *                                       reintenta ni se "prueba otro PIN": cada intento contaria para el bloqueo.
 *   - PIN con formato invalido (400) -> AppError 400 (Facturacion no lo cuenta como intento fallido)
 *   - Facturacion caida o lenta      -> AppError 503; otra respuesta inesperada -> 502
 * El PIN nunca se escribe en mensajes de error ni en logs.
 */
async function validarSupervisor(usuario, pin) {
  const supervisor_id = typeof usuario === "string" ? usuario.trim() : "";
  if (!supervisor_id) throw new AppError("Escriba el usuario del supervisor.", 400);
  if (typeof pin !== "string" || pin === "") throw new AppError("Escriba el PIN del supervisor.", 400);

  let respuesta;
  try {
    respuesta = await fetch(`${urlFacturacion()}/api/supervisores/validar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supervisor_id, pin }),
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (e) {
    const sinRespuesta = e.name === "TimeoutError" || e.name === "AbortError";
    throw new AppError(
      sinRespuesta ? "Facturación no respondió a tiempo al validar al supervisor. Intente de nuevo." : "No se pudo validar al supervisor en este momento. Intente de nuevo.",
      503,
      { causa: e.message }
    );
  }

  const cuerpo = await respuesta.json().catch(() => null);
  if (respuesta.ok && cuerpo?.data) {
    return { supervisor_id: cuerpo.data.supervisor_id, nombre: cuerpo.data.nombre };
  }
  if (respuesta.status === 401) {
    throw new AppError("Usuario o PIN incorrecto", 401, { intentos_restantes: cuerpo?.detalle?.intentos_restantes ?? null });
  }
  if (respuesta.status === 423) {
    throw new AppError(cuerpo?.mensaje || "Supervisor bloqueado por intentos fallidos.", 423, { bloqueado_hasta: cuerpo?.detalle?.bloqueado_hasta ?? null });
  }
  if (respuesta.status === 400) {
    throw new AppError(cuerpo?.mensaje || "Usuario o PIN con formato inválido.", 400);
  }
  throw new AppError("Facturación devolvió una respuesta inesperada al validar al supervisor.", 502, { status: respuesta.status });
}

module.exports = { obtenerFactura, validarSupervisor };
