const cajerosRepo = require("../data/cajerosRepo");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function respuesta(res, status, mensaje) {
  return res.status(status).json({ ok: false, mensaje });
}

/**
 * TDSI-219: "el cajero solo ve SUS datos". Valida el access_token de Supabase Auth del que llama (el que devuelve /api/auth/login) y deja
 * quien es en req.cajero = { cajero_id (id de la cuenta), email, nombre }. El turno se busca SIEMPRE con esa identidad, nunca con un id
 * que mande el cliente: asi un cajero no puede pedir el turno de otro.
 *   - sin token, o token invalido o vencido -> 401
 *   - cuenta desactivada en caja.cajeros -> 403
 */
async function requireCajero(req, res, next) {
  const [esquema, token] = (req.headers.authorization || "").split(" ");
  if (esquema !== "Bearer" || !token) return respuesta(res, 401, "Token de acceso requerido");

  let usuario;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    if (!r.ok) return respuesta(res, 401, "Token invalido o vencido");
    usuario = await r.json();
  } catch (e) {
    return next(e);
  }

  try {
    const perfil = await cajerosRepo.buscarPorCajeroId(usuario.id);
    if (perfil && !perfil.activo) return respuesta(res, 403, "Esta cuenta esta desactivada. Contacte al Administrador.");
    req.cajero = { cajero_id: usuario.id, email: usuario.email, nombre: perfil ? perfil.nombre : usuario.email };
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = { requireCajero };
