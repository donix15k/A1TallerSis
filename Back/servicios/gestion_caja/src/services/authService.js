const { AppError } = require("../utils/AppError");
const cajerosRepo = require("../data/cajerosRepo");
const administradoresRepo = require("../data/administradoresRepo");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

/**
 * Quien inicia sesion escribe su USUARIO (nombre unico); la cuenta de Supabase Auth se identifica con otro correo interno (email_auth).
 * Si lo escrito es el usuario de un cajero o administrador se usa el correo interno de su cuenta; si no (por ejemplo un correo de una
 * cuenta anterior) se usa tal cual. Devuelve { email, usuario }: el correo para Supabase y el usuario con el que se muestra la cuenta.
 */
async function resolverCuenta(identificador) {
  const id = String(identificador ?? "").trim();
  if (!id) return { email: id, usuario: id };
  const fila = (await cajerosRepo.buscarPorUsuario(id)) || (await administradoresRepo.buscarPorUsuario(id));
  if (fila) return { email: fila.email_auth || fila.usuario, usuario: fila.usuario };
  return { email: id.toLowerCase(), usuario: id };
}

/**
 * TDSI-83: autentica al cajero contra Supabase Auth con email y password.
 * TDSI-47/918: si esa cuenta tiene un perfil en caja.cajeros y esta desactivada,
 * se le niega el login aunque la contrasena sea correcta. Si no tiene perfil ahi
 * (p.ej. un Administrador, que usa esta misma funcion) no se bloquea por esto.
 */
async function autenticarCajero({ email, password }) {
  if (!email || !password) {
    throw new AppError("Los campos email y password son obligatorios.", 400);
  }

  const cuenta = await resolverCuenta(email);
  const respuesta = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email: cuenta.email, password }),
  });

  const datos = await respuesta.json();

  if (!respuesta.ok) {
    throw new AppError("Credenciales invalidas.", 401, datos.error_description || datos.msg || null);
  }

  const cajero = await cajerosRepo.buscarPorCajeroId(datos.user.id);
  if (cajero && !cajero.activo) {
    throw new AppError("Esta cuenta esta desactivada. Contacte al Administrador.", 403);
  }

  return {
    cajero_id: datos.user.id,
    email: cuenta.usuario, // el usuario con el que se muestra la cuenta (para las cuentas anteriores es el mismo correo)
    usuario: cuenta.usuario,
    access_token: datos.access_token,
    // para renovar la sesion sin pedir la contrasena otra vez (el access_token de Supabase dura 1 hora)
    refresh_token: datos.refresh_token,
    expires_in: datos.expires_in,
  };
}

/**
 * Renueva la sesion con el refresh_token de Supabase Auth: devuelve un access_token nuevo (y un refresh_token nuevo: Supabase rota el
 * anterior). Un refresh_token invalido o ya usado es 401 y hay que volver a iniciar sesion.
 */
async function renovarSesion({ refresh_token }) {
  if (!refresh_token || typeof refresh_token !== "string") {
    throw new AppError("El campo refresh_token es obligatorio.", 400);
  }
  let respuesta;
  try {
    respuesta = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token }),
    });
  } catch {
    throw new AppError("No se pudo conectar con el servicio de autenticacion para renovar la sesion.", 503);
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new AppError("La sesion ya no se puede renovar: vuelva a iniciar sesion.", 401, datos.error_description || datos.msg || null);
  }
  return { access_token: datos.access_token, refresh_token: datos.refresh_token, expires_in: datos.expires_in };
}
/** TDSI-183: verifica la contraseña del cajero para desbloquear la pantalla. */
async function verificarContrasena(identificador, password) {
  const cuenta = await resolverCuenta(identificador);
  const respuesta = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email: cuenta.email, password }),
  });

  if (!respuesta.ok) {
    return false;
  }
  return true;
}

module.exports = { resolverCuenta, autenticarCajero, verificarContrasena, renovarSesion };
