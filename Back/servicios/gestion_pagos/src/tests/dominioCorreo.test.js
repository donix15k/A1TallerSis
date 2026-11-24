// Validacion del dominio del correo por DNS. El resolvedor es FALSO: las pruebas no salen a internet.
const test = require("node:test");
const assert = require("node:assert/strict");
const { validarDominioCorreo, usarResolvedorDePrueba } = require("../utils/dominioCorreo");

const error = (code) => Object.assign(new Error(code), { code });
// dominios que "existen" con MX, solo con registro A, o que el DNS dice que no existen; "caido" simula un DNS que falla
const resolvedor = {
  resolveMx: async (d) => { if (d === "ucb.edu.bo") return [{ exchange: "mx.ucb.edu.bo", priority: 10 }]; if (d === "caido.com") throw error("ECONNREFUSED"); if (d === "lento.com") return new Promise(() => {}); throw error("ENOTFOUND"); },
  resolve4: async (d) => { if (d === "soloa.com") return ["1.2.3.4"]; if (d === "caido.com") throw error("ECONNREFUSED"); throw error("ENODATA"); },
  resolve6: async () => { throw error("ENODATA"); },
};
test.beforeEach(() => usarResolvedorDePrueba(resolvedor));
test.after(() => usarResolvedorDePrueba(undefined));

test("un dominio con servidor de correo (ucb.edu.bo) pasa", async () => {
  assert.equal(await validarDominioCorreo("alguien@ucb.edu.bo"), null);
  assert.equal(await validarDominioCorreo("ALGUIEN@UCB.EDU.BO"), null);
});

test("un dominio sin MX pero con registro A tambien pasa (asi funciona el correo)", async () => {
  assert.equal(await validarDominioCorreo("x@soloa.com"), null);
});

test("un dominio que el DNS dice que no existe se rechaza con un mensaje claro", async () => {
  assert.match(await validarDominioCorreo("rodnysiles@baquito.com"), /El dominio "baquito\.com" no existe/);
});

test("si el DNS falla o no responde NO se rechaza: no se sabe, se deja enviar", async () => {
  assert.equal(await validarDominioCorreo("x@caido.com"), null);
  const t = Date.now();
  assert.equal(await validarDominioCorreo("x@lento.com"), null);
  assert.ok(Date.now() - t < 5000, "no espera mas del limite");
});
