const { AppError } = require("../utils/AppError");
const cajerosRepo = require("../data/cajerosRepo");
const administradoresRepo = require("../data/administradoresRepo");
const { listarSupervisores, editarSupervisor, cambiarEstadoSupervisor, crearSupervisor, restablecerPinSupervisor } = require("./supervisorProxy");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * TDSI-47/171: crea la cuenta de login en Supabase Auth -- ahi se guarda la
 * contrasena (encriptada, nunca en nuestra BD), igual que con el login que ya
 * existe hoy. Requiere SUPABASE_SERVICE_ROLE_KEY (API de administracion).
 */
async function crearCuentaSupabase({ email, password }) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  const datos = await r.json();
  if (!r.ok) {
    const mensaje = datos.msg || datos.error_description || datos.message || "No se pudo crear la cuenta.";
    if (r.status === 422 && /already.*registered|already exists/i.test(mensaje)) {
      throw new AppError("Ese usuario ya esta registrado.", 409, { usuario: email });
    }
    throw new AppError(mensaje, r.status >= 400 && r.status < 500 ? 400 : 502);
  }
  return datos;
}

/**
 * TDSI-47/917: PUT /auth/v1/admin/users/:id generico (cambia email y/o contrasena).
 */
async function actualizarCuentaSupabase(cajero_id, payload) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${cajero_id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const datos = await r.json();
  if (!r.ok) {
    const mensaje = datos.msg || datos.error_description || datos.message || "No se pudo actualizar la cuenta.";
    if (r.status === 422 && /already.*registered|already exists/i.test(mensaje)) {
      throw new AppError("Ese usuario ya esta registrado.", 409, { usuario: payload.email });
    }
    throw new AppError(mensaje, r.status >= 400 && r.status < 500 ? 400 : 502);
  }
  return datos;
}

function aPublico(cajero) {
  return {
    id: cajero.cajero_id,
    cajero_id: cajero.cajero_id,
    usuario: cajero.usuario,
    nombre: cajero.nombre,
    rol: "Cajero",
    estado: cajero.activo ? "Activo" : "Inactivo",
  };
}

/**
 * TDSI-47/171: el Administrador registra un cajero nuevo. "usuario" es el
 * correo con el que va a iniciar sesion (igual que hoy); la contrasena la
 * pone el Administrador y Supabase la guarda encriptada, nunca se vuelve a
 * mostrar. El nombre/usuario/estado del cajero se guardan en caja.cajeros,
 * con el mismo patron que caja.administradores.
 */
async function crearCajero({ usuario, password, nombre }) {
  if (!usuario || !EMAIL_REGEX.test(String(usuario).trim())) {
    throw new AppError("El usuario debe ser un correo valido.", 400);
  }
  if (!password || String(password).length < 6) {
    throw new AppError("La contrasena debe tener al menos 6 caracteres.", 400);
  }
  if (!nombre || !String(nombre).trim()) {
    throw new AppError("El nombre es obligatorio.", 400);
  }

  const email = String(usuario).trim().toLowerCase();

  const yaExiste = await cajerosRepo.buscarPorUsuario(email);
  if (yaExiste) {
    throw new AppError("Ese usuario ya esta registrado.", 409, { usuario: email });
  }

  const cuenta = await crearCuentaSupabase({ email, password });
  const cajero = await cajerosRepo.crear({ cajero_id: cuenta.id, usuario: email, nombre: String(nombre).trim() });
  return aPublico(cajero);
}

/**
 * TDSI-47/916: lista unificada para la pantalla "Usuarios" -- cajeros (perfil local
 * en caja.cajeros) y supervisores (vía proxy a facturacion), sin contrasenas ni PIN.
 * El filtro por rol lo hace el Front sobre esta misma lista.
 */
async function listarUsuarios() {
  const [cajeros, supervisores, administradores] = await Promise.all([
    cajerosRepo.listar(),
    listarSupervisores(),
    listarAdministradores(),
  ]);

  const filasCajeros = cajeros.map((c) => ({
    id: c.cajero_id,
    usuario: c.usuario,
    nombre: c.nombre,
    rol: "Cajero",
    estado: c.activo ? "Activo" : "Inactivo",
  }));
  const filasSupervisores = supervisores.map((s) => ({
    id: s.id,
    usuario: s.usuario,
    nombre: s.nombre,
    rol: "Supervisor",
    estado: s.estado,
  }));

  return [...administradores, ...filasCajeros, ...filasSupervisores];
}

/**
 * TDSI-47/917: "Editar" en la pantalla "Usuarios" -- cambia nombre y usuario,
 * para un cajero o un supervisor (el id de la fila alcanza para distinguirlos:
 * si existe como cajero_id en caja.cajeros, es un cajero; si no, se intenta
 * como id de supervisor en facturacion).
 */
async function editarUsuario(id, { usuario, nombre, telefono, documento } = {}) {
  if (await administradoresRepo.buscarPorCajeroId(id)) return editarAdministrador(id, { usuario, nombre, telefono, documento });
  const cajero = await cajerosRepo.buscarPorCajeroId(id);
  if (cajero) {
    if (!usuario || !EMAIL_REGEX.test(String(usuario).trim())) {
      throw new AppError("El usuario debe ser un correo valido.", 400);
    }
    if (!nombre || !String(nombre).trim()) {
      throw new AppError("El nombre es obligatorio.", 400);
    }

    const email = String(usuario).trim().toLowerCase();
    if (email !== cajero.usuario) {
      const yaExiste = await cajerosRepo.buscarPorUsuario(email);
      if (yaExiste) throw new AppError("Ese usuario ya esta registrado.", 409, { usuario: email });
      await actualizarCuentaSupabase(id, { email });
    }

    const actualizado = await cajerosRepo.actualizar(id, { usuario: email, nombre: String(nombre).trim() });
    return aPublico(actualizado);
  }

  return editarSupervisor(id, { usuario, nombre });
}

/** TDSI-47/917: "Cambiar contrasena" -- solo existe para cajeros (login con Supabase Auth). */
async function cambiarPasswordCajero(cajero_id, { password } = {}) {
  if (!password || String(password).length < 6) {
    throw new AppError("La contrasena debe tener al menos 6 caracteres.", 400);
  }

  const cajero = await cajerosRepo.buscarPorCajeroId(cajero_id);
  if (!cajero) throw new AppError("Cajero no encontrado.", 404);

  await actualizarCuentaSupabase(cajero_id, { password });
  return aPublico(cajero);
}

/**
 * TDSI-47/918: "Activar" / "Desactivar" en la pantalla "Usuarios" -- para un cajero
 * o un supervisor (mismo criterio que editarUsuario). Un cajero desactivado no
 * puede volver a iniciar sesion (ver authService.autenticarCajero).
 */
async function cambiarEstadoUsuario(id, { activo } = {}, { solicitante_id } = {}) {
  if (typeof activo !== "boolean") {
    throw new AppError("El campo 'activo' es obligatorio y debe ser true o false.", 400);
  }
  if (await administradoresRepo.buscarPorCajeroId(id)) return cambiarEstadoAdministrador(id, activo, solicitante_id);

  const cajero = await cajerosRepo.buscarPorCajeroId(id);
  if (cajero) {
    const actualizado = await cajerosRepo.cambiarEstado(id, activo);
    return aPublico(actualizado);
  }

  return cambiarEstadoSupervisor(id, activo);
}

// ============================================================================ Administradores y credenciales (pantalla "Usuarios y accesos")
const PASSWORD_MINIMA_ADMIN = 8;

function validarPasswordAdmin(password) {
  if (!password || String(password).length < PASSWORD_MINIMA_ADMIN) {
    throw new AppError(`La contrasena de un administrador debe tener al menos ${PASSWORD_MINIMA_ADMIN} caracteres.`, 400);
  }
}

function textoOpcional(valor, campo, max) {
  if (valor === undefined || valor === null || String(valor).trim() === "") return null;
  const t = String(valor).trim();
  if (t.length > max) throw new AppError(`El campo '${campo}' admite como maximo ${max} caracteres.`, 400);
  return t;
}

const validarTelefono = (valor) => {
  const t = textoOpcional(valor, "telefono", 30);
  if (t !== null && !/^[0-9+()\-\s]{6,30}$/.test(t)) throw new AppError("El telefono solo puede tener numeros, espacios, + ( ) y guiones.", 400, { telefono: valor });
  return t;
};
const validarDocumento = (valor) => {
  const t = textoOpcional(valor, "documento", 20);
  if (t !== null && !/^[A-Za-z0-9\-]{5,20}$/.test(t)) throw new AppError("El documento debe tener entre 5 y 20 letras o numeros.", 400, { documento: valor });
  return t;
};
function validarNombre(valor) {
  const t = String(valor ?? "").trim();
  if (!t) throw new AppError("El nombre es obligatorio.", 400);
  if (t.length > 150) throw new AppError("El nombre admite como maximo 150 caracteres.", 400);
  return t;
}

/** El correo de una cuenta de Supabase Auth (para los administradores creados antes de guardar el correo en caja.administradores). */
async function correoDeCuenta(id) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } });
    if (!r.ok) return null;
    return (await r.json()).email ?? null;
  } catch {
    return null;
  }
}

function administradorPublico(a) {
  return {
    id: a.cajero_id,
    usuario: a.usuario,
    nombre: a.nombre || a.usuario,
    telefono: a.telefono ?? null,
    documento: a.documento ?? null,
    rol: "Administrador",
    estado: a.activo ? "Activo" : "Inactivo",
  };
}

/** Los administradores, con su correo (si falta se completa desde Supabase y se guarda para la proxima). */
async function listarAdministradores() {
  const filas = await administradoresRepo.listar();
  const completas = await Promise.all(
    filas.map(async (a) => {
      if (a.usuario) return a;
      const correo = await correoDeCuenta(a.cajero_id);
      return correo ? (await administradoresRepo.actualizarUsuario(a.cajero_id, correo.toLowerCase())) ?? a : a;
    })
  );
  return completas.map(administradorPublico);
}

/**
 * Un administrador nuevo: su cuenta de login (Supabase Auth, contrasena de al menos 8 caracteres) y su perfil en caja.administradores.
 * Si falla el perfil se borra la cuenta recien creada (no quedan cuentas huerfanas).
 */
async function crearAdministrador({ usuario, password, nombre, telefono, documento } = {}) {
  if (!usuario || !EMAIL_REGEX.test(String(usuario).trim())) throw new AppError("El usuario debe ser un correo valido.", 400);
  validarPasswordAdmin(password);
  const nom = validarNombre(nombre);
  const tel = validarTelefono(telefono);
  const doc = validarDocumento(documento);
  const email = String(usuario).trim().toLowerCase();
  if ((await administradoresRepo.buscarPorUsuario(email)) || (await cajerosRepo.buscarPorUsuario(email))) {
    throw new AppError("Ese usuario ya esta registrado.", 409, { usuario: email });
  }
  const cuenta = await crearCuentaSupabase({ email, password });
  try {
    return administradorPublico(await administradoresRepo.crear({ cajero_id: cuenta.id, usuario: email, nombre: nom, telefono: tel, documento: doc }));
  } catch (e) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${cuenta.id}`, { method: "DELETE", headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }).catch(() => {});
    throw e;
  }
}

/** Un administrador cambia nombre, correo y datos personales de otro (o de si mismo). */
async function editarAdministrador(id, { usuario, nombre, telefono, documento } = {}) {
  const actual = await administradoresRepo.buscarPorCajeroId(id);
  if (!actual) throw new AppError("Administrador no encontrado.", 404);
  if (!usuario || !EMAIL_REGEX.test(String(usuario).trim())) throw new AppError("El usuario debe ser un correo valido.", 400);
  const email = String(usuario).trim().toLowerCase();
  const perfil = { nombre: validarNombre(nombre), telefono: validarTelefono(telefono), documento: validarDocumento(documento) };
  if (email !== (actual.usuario || "").toLowerCase()) {
    const otro = (await administradoresRepo.buscarPorUsuario(email)) || (await cajerosRepo.buscarPorUsuario(email));
    if (otro && otro.cajero_id !== id) throw new AppError("Ese usuario ya esta registrado.", 409, { usuario: email });
    await actualizarCuentaSupabase(id, { email });
    await administradoresRepo.actualizarUsuario(id, email);
  }
  return administradorPublico(await administradoresRepo.actualizarPerfil(id, perfil));
}

/**
 * Activar / desactivar ("dar de baja") un administrador. Un administrador desactivado no puede iniciar sesion ni usar el panel (lo valida requireAdministrador).
 * Reglas: nadie puede desactivarse a si mismo y siempre debe quedar al menos un administrador activo.
 */
async function cambiarEstadoAdministrador(id, activo, solicitanteId) {
  const actual = await administradoresRepo.buscarPorCajeroId(id);
  if (!actual) throw new AppError("Administrador no encontrado.", 404);
  if (!activo) {
    if (solicitanteId && solicitanteId === id) throw new AppError("No puede desactivar su propia cuenta.", 409);
    if (actual.activo && (await administradoresRepo.contarActivos()) <= 1) throw new AppError("Debe quedar al menos un administrador activo.", 409);
  }
  return administradorPublico(await administradoresRepo.cambiarEstado(id, activo));
}

/**
 * "Restablecer contrasena / PIN" desde la lista: cajeros y administradores cambian su contrasena (Supabase Auth); los supervisores su PIN.
 * El id alcanza para saber de quien es (administrador, cajero o supervisor).
 */
async function restablecerCredencial(id, { password, pin } = {}) {
  const admin = await administradoresRepo.buscarPorCajeroId(id);
  if (admin) {
    validarPasswordAdmin(password);
    await actualizarCuentaSupabase(id, { password });
    return administradorPublico(admin);
  }
  const cajero = await cajerosRepo.buscarPorCajeroId(id);
  if (cajero) return cambiarPasswordCajero(id, { password });
  await restablecerPinSupervisor(id, pin);
  return { id, rol: "Supervisor" };
}

// ---------------------------------------------------------------- perfil propio del administrador
async function obtenerPerfil(id) {
  let a = await administradoresRepo.buscarPorCajeroId(id);
  if (!a) throw new AppError("Administrador no encontrado.", 404);
  if (!a.usuario) {
    const correo = await correoDeCuenta(id);
    if (correo) a = (await administradoresRepo.actualizarUsuario(id, correo.toLowerCase())) ?? a;
  }
  return administradorPublico(a);
}

/** El propio administrador edita su nombre y sus datos personales (el correo y el rol los cambia otro administrador). */
async function actualizarPerfilPropio(id, { nombre, telefono, documento } = {}) {
  const a = await administradoresRepo.buscarPorCajeroId(id);
  if (!a) throw new AppError("Administrador no encontrado.", 404);
  const actualizado = await administradoresRepo.actualizarPerfil(id, { nombre: validarNombre(nombre), telefono: validarTelefono(telefono), documento: validarDocumento(documento) });
  return administradorPublico(actualizado);
}

/** Cambia la contrasena propia: exige la actual (se comprueba contra Supabase Auth) y la nueva con al menos 8 caracteres, distinta de la actual. */
async function cambiarPasswordPropia(id, { password_actual, password_nueva } = {}, verificar) {
  const a = await administradoresRepo.buscarPorCajeroId(id);
  if (!a) throw new AppError("Administrador no encontrado.", 404);
  if (!password_actual) throw new AppError("Escriba su contrasena actual.", 400);
  validarPasswordAdmin(password_nueva);
  if (password_nueva === password_actual) throw new AppError("La contrasena nueva debe ser distinta de la actual.", 400);
  const correo = a.usuario || (await correoDeCuenta(id));
  if (!correo || !(await verificar(correo, password_actual))) throw new AppError("La contrasena actual no es correcta.", 403);
  await actualizarCuentaSupabase(id, { password: password_nueva });
  return { ok: true };
}

module.exports = {
  crearCajero, listarUsuarios, editarUsuario, cambiarPasswordCajero, cambiarEstadoUsuario,
  crearAdministrador, listarAdministradores, editarAdministrador, cambiarEstadoAdministrador, restablecerCredencial, crearSupervisor,
  obtenerPerfil, actualizarPerfilPropio, cambiarPasswordPropia,
};
