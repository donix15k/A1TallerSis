const { AppError } = require("../utils/AppError");

// Gestion de Pagos no guarda cuentas de administrador: le pregunta a Gestion de Caja (que valida el token de Supabase Auth y
// que sea un administrador activo) con GET /api/administradores/verificar. ADMIN_VERIFICAR_URL permite apuntar a otro servicio.
const urlVerificar = () => `${process.env.ADMIN_VERIFICAR_URL || process.env.GESTION_CAJA_URL || "http://localhost:4004"}/api/administradores/verificar`;
const timeoutMs = () => Number(process.env.CAJA_TIMEOUT_MS) || 5000;

/**
 * TDSI-125: "solo el administrador ve esta pantalla" (Monitor de integraciones). Exige un Bearer token de Administrador:
 *   - sin token o token invalido o vencido -> 401
 *   - cuenta que no es administrador activo -> 403
 *   - Gestion de Caja caida o lenta -> 503
 * Deja el token en req.tokenAdministrador para reenviarlo a los servicios que tambien lo validan.
 */
async function requireAdministrador(req, res, next) {
  const [esquema, token] = (req.headers.authorization || "").split(" ");
  if (esquema !== "Bearer" || !token) return next(new AppError("Token de acceso requerido", 401));

  let respuesta;
  try {
    respuesta = await fetch(urlVerificar(), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs()) });
  } catch (e) {
    const lenta = e.name === "TimeoutError" || e.name === "AbortError";
    return next(new AppError(lenta ? "Gestión de Caja no respondió a tiempo para validar al administrador." : "No se pudo conectar con Gestión de Caja para validar al administrador.", 503));
  }
  const cuerpo = await respuesta.json().catch(() => null);

  if (respuesta.status === 200 && cuerpo?.data) {
    req.administrador = cuerpo.data;
    req.tokenAdministrador = token;
    return next();
  }
  if (respuesta.status === 401) return next(new AppError(cuerpo?.mensaje || "Token invalido o vencido", 401));
  if (respuesta.status === 403) return next(new AppError(cuerpo?.mensaje || "Esta accion requiere permisos de Administrador.", 403));
  return next(new AppError("No se pudo validar al administrador.", 502, { status: respuesta.status }));
}

module.exports = { requireAdministrador };
