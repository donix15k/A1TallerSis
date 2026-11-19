// TDSI-12: plazo de 7 dias calendario con hora de Bolivia (America/La_Paz, UTC-4).
const test = require("node:test");
const assert = require("node:assert/strict");
const { estaDentroDePlazo } = require("../utils/plazo");

// Factura del 10/11/2026 16:40 hora de Bolivia (= 20:40 UTC).
const FACTURA = "2026-11-10T20:40:00Z";

test("el mismo dia esta dentro de plazo (0 dias)", () => {
  const p = estaDentroDePlazo(FACTURA, new Date("2026-11-10T21:00:00Z"));
  assert.equal(p.dentro_de_plazo, true);
  assert.equal(p.dias_transcurridos, 0);
  assert.equal(p.fecha_factura, "2026-11-10");
  assert.equal(p.fecha_limite, "2026-11-17");
});

test("el dia 7 todavia esta dentro de plazo, a cualquier hora", () => {
  // 17/11 a las 00:00 y a las 23:59 hora de Bolivia
  assert.equal(estaDentroDePlazo(FACTURA, new Date("2026-11-17T04:00:00Z")).dentro_de_plazo, true);
  const tarde = estaDentroDePlazo(FACTURA, new Date("2026-11-18T03:59:00Z"));
  assert.equal(tarde.dentro_de_plazo, true);
  assert.equal(tarde.dias_transcurridos, 7);
});

test("el dia 8 ya esta fuera de plazo", () => {
  const p = estaDentroDePlazo(FACTURA, new Date("2026-11-18T04:00:00Z")); // 18/11 00:00 en Bolivia
  assert.equal(p.dentro_de_plazo, false);
  assert.equal(p.dias_transcurridos, 8);
});

test("usa la fecha de Bolivia, no la UTC: 01:00 UTC del 18/11 sigue siendo 17/11 en Bolivia", () => {
  // Con fechas UTC serian 8 dias (fuera); en Bolivia son 7 (dentro).
  assert.equal(estaDentroDePlazo(FACTURA, new Date("2026-11-18T01:00:00Z")).dentro_de_plazo, true);
});

test("una factura emitida de noche en Bolivia cuenta con su fecha boliviana", () => {
  // 10/11 22:30 en Bolivia = 11/11 02:30 UTC. Para Bolivia la factura es del 10/11.
  const p = estaDentroDePlazo("2026-11-11T02:30:00Z", new Date("2026-11-17T20:00:00Z"));
  assert.equal(p.fecha_factura, "2026-11-10");
  assert.equal(p.dias_transcurridos, 7);
  assert.equal(p.dentro_de_plazo, true);
});

test("el limite en dias se puede cambiar", () => {
  assert.equal(estaDentroDePlazo(FACTURA, new Date("2026-11-14T15:00:00Z"), 3).dentro_de_plazo, false);
  assert.equal(estaDentroDePlazo(FACTURA, new Date("2026-11-13T15:00:00Z"), 3).dentro_de_plazo, true);
});

test("cruza fin de mes y de año sin errores", () => {
  const p = estaDentroDePlazo("2026-12-28T15:00:00Z", new Date("2027-01-04T15:00:00Z"));
  assert.equal(p.dias_transcurridos, 7);
  assert.equal(p.dentro_de_plazo, true);
  assert.equal(p.fecha_limite, "2027-01-04");
});
