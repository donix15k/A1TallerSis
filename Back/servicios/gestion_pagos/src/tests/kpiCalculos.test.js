// TDSI-137: calculos puros del Panel de KPIs (sin base ni red): periodo, ticket promedio y semaforo.
const test = require("node:test");
const assert = require("node:assert/strict");
const { rangoDelPeriodo, calcularTicketPromedio, colorTicketPromedio, hoyBolivia } = require("../services/kpiService");

test("rangoDelPeriodo: el mes completo (primer y ultimo dia), con meses de 28, 29, 30 y 31 dias", () => {
  assert.deepEqual(rangoDelPeriodo("2026-11"), { periodo: "2026-11", desde: "2026-11-01", hasta: "2026-11-30" });
  assert.equal(rangoDelPeriodo("2026-12").hasta, "2026-12-31");
  assert.equal(rangoDelPeriodo("2026-02").hasta, "2026-02-28");
  assert.equal(rangoDelPeriodo("2028-02").hasta, "2028-02-29"); // bisiesto
  assert.equal(rangoDelPeriodo(" 2026-01 ").desde, "2026-01-01");
});

test("rangoDelPeriodo: sin periodo usa el mes actual EN BOLIVIA (a las 02:00Z del 1/12 en Bolivia todavia es noviembre)", () => {
  assert.equal(rangoDelPeriodo(undefined, { ahora: new Date("2026-12-01T02:00:00Z") }).periodo, "2026-11");
  assert.equal(rangoDelPeriodo("", { ahora: new Date("2026-12-01T04:00:00Z") }).periodo, "2026-12");
  assert.equal(hoyBolivia(new Date("2026-03-11T03:59:59Z")), "2026-03-10");
  assert.equal(hoyBolivia(new Date("2026-03-11T04:00:00Z")), "2026-03-11");
});

test("rangoDelPeriodo: un periodo que no es AAAA-MM real da 400", () => {
  for (const malo of ["2026-13", "2026-00", "2026-1", "26-11", "2026/11", "noviembre", "2026-11-15", "1999-12", "2101-01", "abc-de"]) {
    assert.throws(() => rangoDelPeriodo(malo), (e) => e.status === 400, malo);
  }
});

test("ticket promedio = total vendido / ventas validas, a 2 decimales", () => {
  assert.equal(calcularTicketPromedio(464.1, 10), 46.41);
  assert.equal(calcularTicketPromedio(100, 3), 33.33);
  assert.equal(calcularTicketPromedio(200, 3), 66.67);
  assert.equal(calcularTicketPromedio("90.50", "2"), 45.25);
  assert.equal(calcularTicketPromedio(0.1 + 0.2, 1), 0.3); // sin el error de coma flotante
});

test("sin ventas el ticket promedio es Bs 0,00 (nunca NaN ni Infinity)", () => {
  for (const ventas of [0, "0", -1, null, undefined, NaN]) assert.equal(calcularTicketPromedio(500, ventas), 0);
  assert.equal(calcularTicketPromedio(0, 0), 0);
});

test("semaforo: VERDE desde Bs 45, AMARILLO de Bs 35 a 44,99, ROJO por debajo de Bs 35", () => {
  const casos = [[46.38, "VERDE"], [45, "VERDE"], [200, "VERDE"], [44.99, "AMARILLO"], [40, "AMARILLO"], [35, "AMARILLO"], [34.99, "ROJO"], [10, "ROJO"], [0, "ROJO"]];
  for (const [valor, color] of casos) assert.equal(colorTicketPromedio(valor), color, String(valor));
  assert.equal(colorTicketPromedio(44.994999), "AMARILLO"); // se compara en centavos, no en coma flotante
});

test("el ejemplo del enunciado: Bs 46,38 de ticket promedio es VERDE", () => {
  assert.equal(colorTicketPromedio(calcularTicketPromedio(4638, 100)), "VERDE");
});
