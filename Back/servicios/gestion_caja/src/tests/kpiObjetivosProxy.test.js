// TDSI-191: Caja pinta los colores de sus KPIs con los objetivos vigentes de Gestion de Pagos (GET /api/kpis/objetivos). Gestion de
// Pagos es un servidor HTTP local; los turnos de prueba (octubre de 2000) se insertan DIRECTO y se borran al terminar.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { query, pool } = require("../config/db");
const { limitesDe, colorSegun, reiniciarCache, INICIALES } = require("../services/objetivosProxy");
const { cuadreCaja } = require("../services/kpiCuadreService");

let pagos;
let respuesta; // lo que responde Gestion de Pagos: lista de indicadores, o "caida"
let pedidos;

const objetivo = (indicador, verde, amarillo, rojo, sentido = "MAYOR") => ({ indicador, verde, amarillo, rojo, sentido });

test.before(async () => {
  process.env.OBJETIVOS_TTL_MS = "100000"; // el cache no vence durante la prueba (se limpia a mano)
  pagos = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    pedidos.push({ url: req.url, token: req.headers.authorization || "" });
    if (respuesta === "caida") { res.statusCode = 500; return res.end(JSON.stringify({ ok: false })); }
    res.end(JSON.stringify({ ok: true, data: { indicadores: respuesta } }));
  });
  await new Promise((r) => pagos.listen(0, r));
  process.env.GESTION_PAGOS_URL = `http://localhost:${pagos.address().port}`;

  await query(`DELETE FROM caja.turnos WHERE codigo LIKE 'T191-%'`);
  // octubre de 2000: 4 turnos cerrados con arqueo, 3 CUADRA y 1 FALTANTE -> 75 %
  for (let i = 0; i < 4; i++) {
    await query(
      `INSERT INTO caja.turnos (codigo, caja_id, cajero_id, diferencia, tipo_diferencia, estado, abierto_en, cerrado_en) VALUES ($1, 'CAJA-T191', 'c191', $2, $3, 'CERRADO', $4::timestamptz, $4::timestamptz)`,
      [`T191-${i}`, i === 3 ? -5 : 0, i === 3 ? "FALTANTE" : "CUADRA", `2000-10-0${i + 1} 20:00:00-04`]
    );
  }
});
test.beforeEach(() => {
  reiniciarCache();
  pedidos = [];
  respuesta = [objetivo("efectividad_cuadre", 90, 70, 0), objetivo("cumplimiento_metas", 100, 70, 0)];
});
test.after(async () => {
  delete process.env.OBJETIVOS_TTL_MS;
  pagos.close();
  await query(`DELETE FROM caja.turnos WHERE codigo LIKE 'T191-%'`);
  await pool.end();
});

test("colorSegun: MAYOR (mas es mejor) y MENOR (menos es mejor); sin dato no hay color", () => {
  const mayor = { verde: 95, amarillo: 85, sentido: "MAYOR" };
  assert.deepEqual([95, 94.99, 85, 84.99].map((v) => colorSegun(v, mayor)), ["VERDE", "AMARILLO", "AMARILLO", "ROJO"]);
  const menor = { verde: 7, amarillo: 15, sentido: "MENOR" };
  assert.deepEqual([7, 7.01, 15, 15.01].map((v) => colorSegun(v, menor)), ["VERDE", "AMARILLO", "AMARILLO", "ROJO"]);
  assert.deepEqual([null, undefined, "", NaN].map((v) => colorSegun(v, mayor)), [null, null, null, null]);
});

test("pide los objetivos a Gestion de Pagos con el token del administrador y los guarda unos segundos", async () => {
  const a = await limitesDe("efectividad_cuadre", { token: "TOK" });
  assert.deepEqual([a.verde, a.amarillo], [90, 70]);
  assert.equal(pedidos[0].url, "/api/kpis/objetivos");
  assert.equal(pedidos[0].token, "Bearer TOK");
  await limitesDe("cumplimiento_metas", { token: "TOK" });
  assert.equal(pedidos.length, 1); // la segunda salio del cache
});

test("si Gestion de Pagos no responde se usan los rangos iniciales del PDF (y se vuelve a intentar despues)", async () => {
  respuesta = "caida";
  assert.deepEqual(await limitesDe("efectividad_cuadre", { token: "TOK" }), INICIALES.efectividad_cuadre);
  assert.deepEqual(await limitesDe("cumplimiento_metas", { token: "TOK" }), INICIALES.cumplimiento_metas);
  assert.equal(pedidos.length, 2); // lo que fallo no se guarda
  respuesta = [objetivo("efectividad_cuadre", 90, 70, 0)];
  assert.equal((await limitesDe("efectividad_cuadre", { token: "TOK" })).verde, 90);
  const url = process.env.GESTION_PAGOS_URL;
  process.env.GESTION_PAGOS_URL = "http://localhost:1";
  try {
    reiniciarCache();
    assert.deepEqual(await limitesDe("efectividad_cuadre", { token: "TOK" }), INICIALES.efectividad_cuadre); // ni conecta
  } finally {
    process.env.GESTION_PAGOS_URL = url;
  }
});

test("un indicador que Gestion de Pagos no trae usa su rango inicial", async () => {
  respuesta = [objetivo("otro", 1, 2, 3)];
  assert.deepEqual(await limitesDe("efectividad_cuadre", { token: "TOK" }), INICIALES.efectividad_cuadre);
});

test("el cuadre de caja usa los objetivos vigentes: 75 % es ROJO con el rango del PDF y AMARILLO con 'amarillo desde 70'", async () => {
  respuesta = [objetivo("efectividad_cuadre", 95, 85, 0)];
  let d = await cuadreCaja({ periodo: "2000-10", token: "TOK" });
  assert.deepEqual([d.porcentaje, d.color, d.umbrales], [75, "ROJO", { verde: 95, amarillo: 85 }]);
  reiniciarCache();
  respuesta = [objetivo("efectividad_cuadre", 90, 70, 0)]; // el administrador cambio los objetivos
  d = await cuadreCaja({ periodo: "2000-10", token: "TOK" });
  assert.deepEqual([d.porcentaje, d.color, d.umbrales], [75, "AMARILLO", { verde: 90, amarillo: 70 }]);
  reiniciarCache();
  respuesta = [objetivo("efectividad_cuadre", 70, 50, 0)];
  assert.equal((await cuadreCaja({ periodo: "2000-10", token: "TOK" })).color, "VERDE");
});
