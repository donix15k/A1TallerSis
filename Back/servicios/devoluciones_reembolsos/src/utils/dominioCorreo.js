// Valida que el DOMINIO de un correo exista de verdad (consulta DNS: registros MX y, si no hay, A/AAAA). No comprueba que exista el buzon:
// eso no se puede saber antes de enviar. Solo rechaza cuando el DNS responde CLARAMENTE que el dominio no existe; si la consulta falla por la
// red, el tiempo o el DNS (ECONNREFUSED, timeout, SERVFAIL...) no se sabe nada y el correo se deja enviar igual (nunca un falso "no existe").
const dns = require("dns").promises;

const NO_EXISTE = new Set(["ENOTFOUND", "ENODATA"]);
const ESPERA_MS = 3000;
const VIGENCIA_EXISTE_MS = 10 * 60 * 1000;
const VIGENCIA_NO_EXISTE_MS = 60 * 1000;

let resolvedor = dns;
const cache = new Map(); // dominio -> { existe, hasta }

/** Solo para pruebas: reemplaza la consulta DNS (undefined vuelve a la real). */
function usarResolvedorDePrueba(falso) {
  resolvedor = falso || dns;
  cache.clear();
}

function conLimite(promesa) {
  let timer;
  const limite = new Promise((_, rechazar) => {
    timer = setTimeout(() => rechazar(Object.assign(new Error("DNS sin respuesta"), { code: "ETIMEOUT" })), ESPERA_MS);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(timer));
}

/** true = existe, false = el DNS dice que no existe, null = no se pudo saber. */
async function dominioExiste(dominio) {
  for (const consulta of ["resolveMx", "resolve4", "resolve6"]) {
    try {
      const r = await conLimite(resolvedor[consulta](dominio));
      if (Array.isArray(r) && r.length > 0) return true;
    } catch (e) {
      if (!NO_EXISTE.has(e.code)) return null; // el DNS fallo: no se sabe
    }
  }
  return false;
}

/** Devuelve un mensaje de error si el dominio del correo NO existe, o null si existe o no se pudo comprobar. */
async function validarDominioCorreo(email) {
  // las pruebas automaticas no salen a internet salvo que inyecten su propio resolvedor
  if (process.env.NODE_TEST_CONTEXT && resolvedor === dns) return null;
  const dominio = String(email ?? "").trim().split("@").pop().toLowerCase();
  if (!dominio || !dominio.includes(".")) return null; // el formato ya lo valida otra regla
  const guardado = cache.get(dominio);
  let existe;
  if (guardado && guardado.hasta > Date.now()) existe = guardado.existe;
  else {
    existe = await dominioExiste(dominio);
    if (existe !== null) cache.set(dominio, { existe, hasta: Date.now() + (existe ? VIGENCIA_EXISTE_MS : VIGENCIA_NO_EXISTE_MS) });
  }
  return existe === false ? `El dominio "${dominio}" no existe: revise que el correo esté bien escrito.` : null;
}

module.exports = { validarDominioCorreo, usarResolvedorDePrueba };
