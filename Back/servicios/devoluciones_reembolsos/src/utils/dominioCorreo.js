// Valida que el DOMINIO de un correo exista de verdad (consulta DNS: registros MX y, si no hay, A/AAAA). No comprueba que exista el buzon:
// eso no se puede saber antes de enviar. Solo rechaza cuando el DNS responde CLARAMENTE que el dominio no existe o que no recibe correo (sin servidores de correo utiles); si la consulta falla por la
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
// Un servidor de correo que no puede recibir nada: vacio, "." (MX nulo, el dominio declara que NO recibe correo) o "localhost" (mal configurado).
const servidorInutil = (host) => {
  const h = String(host ?? "").trim().toLowerCase().replace(/\.$/, "");
  return h === "" || h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1";
};

async function dominioExiste(dominio) {
  // 1) Registros MX: si el dominio declara servidores de correo, alguno tiene que servir. Si declara solo servidores inutiles, no recibe correo.
  try {
    const mx = await conLimite(resolvedor.resolveMx(dominio));
    if (Array.isArray(mx) && mx.length > 0) return mx.some((m) => !servidorInutil(m.exchange));
  } catch (e) {
    if (!NO_EXISTE.has(e.code)) return null; // el DNS fallo: no se sabe
  }
  // 2) Sin MX, el correo va a la direccion del dominio (registro A / AAAA).
  for (const consulta of ["resolve4", "resolve6"]) {
    try {
      const r = await conLimite(resolvedor[consulta](dominio));
      if (Array.isArray(r) && r.length > 0) return true;
    } catch (e) {
      if (!NO_EXISTE.has(e.code)) return null;
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
  return existe === false ? `El dominio "${dominio}" no existe o no recibe correo: revise que el correo esté bien escrito.` : null;
}

module.exports = { validarDominioCorreo, usarResolvedorDePrueba };
