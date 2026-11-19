// TDSI-125: Monitor de integraciones. Reune en un solo lugar los mensajes que cada microservicio envia a otros grupos
// (Contabilidad D, Compras C, Marketplace E) para que el administrador vea si todo llego.
const { fuentes } = require("./integraciones/fuentes");

/**
 * TDSI-126: pide los envios a TODOS los microservicios en paralelo. Si uno no responde, el monitor igual muestra lo de los
 * demas y avisa cual fallo en `fuentes` ({ origen, ok, total, error }): un servicio caido no deja ciega a la pantalla.
 * Devuelve { mensajes, fuentes } con los mensajes del mas reciente al mas viejo.
 */
async function reunirMensajes({ token = null } = {}) {
  const lista = fuentes();
  const resultados = await Promise.allSettled(lista.map((f) => f.listar({ token })));
  const mensajes = [];
  const estadoFuentes = resultados.map((r, i) => {
    if (r.status === "fulfilled") {
      mensajes.push(...r.value);
      return { origen: lista[i].origen, ok: true, total: r.value.length };
    }
    return { origen: lista[i].origen, ok: false, total: 0, error: r.reason?.message || "error desconocido" };
  });
  mensajes.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
  return { mensajes, fuentes: estadoFuentes };
}

/**
 * TDSI-126: todos los mensajes (grupo, tipo, fecha, estado y messageId) de los cinco microservicios.
 */
async function listarMensajes({ token = null } = {}) {
  const { mensajes, fuentes: estadoFuentes } = await reunirMensajes({ token });
  return { total: mensajes.length, fuentes: estadoFuentes, data: mensajes };
}

module.exports = { reunirMensajes, listarMensajes };
