const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 150; // largo de devoluciones.envios_comprobante.email_destino

/** true si el correo tiene un formato valido (algo@dominio.ext, sin espacios) y cabe en la base. */
function emailValido(email) {
  const e = String(email ?? "").trim();
  return e.length <= EMAIL_MAX && EMAIL_REGEX.test(e);
}

module.exports = { EMAIL_REGEX, emailValido };
