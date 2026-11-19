// TDSI-70: metodo de pago "Vale" en pago simple y mixto. BD real de pagos; Devoluciones es un servidor HTTP local con
// vales de mentira (llamadas HTTP de verdad). Limpia las ventas que crea.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { query, pool } = require("../config/db");
const { registrarPagoSimple } = require("../services/pagoSimpleService");
const { registrarPagoMixto } = require("../services/pagoMixtoService");

let servidor;
let vales; // codigo -> { saldo, estado, usos: Map(referencia -> monto) }
let llamadas;
let usarFalla; // si es un numero, /usar responde con ese estado
const CAJERO = `cajero.vale.${Date.now()}`;
const creadas = [];

const registrarCreada = (r) => {
  const id = r.pago?.id_transaccion;
  if (id) creadas.push(id);
  return r;
};

test.before(async () => {
  servidor = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => (cuerpo += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      const datos = cuerpo ? JSON.parse(cuerpo) : {};
      llamadas.push({ metodo: req.method, url: req.url, cuerpo: datos });
      const m = req.url.match(/^\/api\/vales\/([^/]+)(\/usar|\/revertir-uso)?$/);
      const vale = m && vales.get(decodeURIComponent(m[1]));
      if (!vale) { res.statusCode = 404; return res.end(JSON.stringify({ ok: false, mensaje: `No existe el vale ${m && m[1]}.` })); }
      if (req.method === "GET") {
        const utilizable = vale.estado === "ACTIVO" && vale.saldo > 0;
        return res.end(JSON.stringify({ ok: true, data: { codigo: m[1], estado: vale.estado, saldo_disponible: utilizable ? vale.saldo : 0, utilizable } }));
      }
      if (m[2] === "/usar") {
        if (usarFalla) { res.statusCode = usarFalla; return res.end(JSON.stringify({ ok: false, mensaje: "El vale no tiene saldo disponible" })); }
        if (vale.usos.has(datos.referencia)) return res.end(JSON.stringify({ ok: true, data: { duplicado: true } }));
        vale.saldo = Math.round((vale.saldo - datos.monto) * 100) / 100;
        vale.usos.set(datos.referencia, datos.monto);
        if (vale.saldo === 0) vale.estado = "USADO";
        return res.end(JSON.stringify({ ok: true, data: { saldo_disponible: vale.saldo, estado: vale.estado } }));
      }
      const monto = vale.usos.get(datos.referencia);
      if (monto !== undefined) { vale.usos.delete(datos.referencia); vale.saldo += monto; vale.estado = "ACTIVO"; }
      res.end(JSON.stringify({ ok: true, data: {} }));
    });
  });
  await new Promise((r) => servidor.listen(0, r));
  process.env.DEVOLUCIONES_URL = `http://localhost:${servidor.address().port}`;
});

test.beforeEach(() => {
  vales = new Map([["VAL-4F8K2A", { saldo: 80, estado: "ACTIVO", usos: new Map() }]]);
  llamadas = [];
  usarFalla = null;
});

test.after(async () => {
  for (const id of creadas) {
    await query(`DELETE FROM pagos.transacciones WHERE id_transaccion = $1`, [id]);
    await query(`DELETE FROM pagos.pagos_mixtos WHERE id_transaccion = $1`, [id]);
  }
  servidor.closeAllConnections();
  await new Promise((r) => servidor.close(r));
  await pool.end();
});

const venta = (extra) => registrarPagoSimple({ metodo: "Vale", monto: 50, codigo_vale: "VAL-4F8K2A", cajero: CAJERO, ...extra });
const contar = async () => (await query(`SELECT count(*)::int n FROM pagos.transacciones WHERE cajero = $1`, [CAJERO])).rows[0].n;
const filas = async (id) => (await query(`SELECT metodo, monto, codigo_vale FROM pagos.transacciones WHERE id_transaccion = $1`, [id])).rows;

test("pagar 50 Bs con un vale de 80: la venta se registra con el codigo del vale y al vale le quedan 30 Bs", async () => {
  const r = registrarCreada(await venta());
  assert.equal(r.pago.metodo, "Vale");
  assert.equal(r.pago.monto, 50);
  assert.equal(r.pago.codigo_vale, "VAL-4F8K2A");
  assert.equal(vales.get("VAL-4F8K2A").saldo, 30);
  const uso = llamadas.find((l) => l.url.endsWith("/usar"));
  assert.deepEqual(uso.cuerpo, { monto: 50, referencia: r.pago.id_transaccion });
  assert.deepEqual((await filas(r.pago.id_transaccion)).map((f) => [f.metodo, Number(f.monto), f.codigo_vale]), [["Vale", 50, "VAL-4F8K2A"]]);
});

test("el codigo se acepta en minusculas", async () => {
  const r = registrarCreada(await venta({ codigo_vale: " val-4f8k2a " }));
  assert.equal(r.pago.codigo_vale, "VAL-4F8K2A");
});

test("un vale vencido o ya usado no se puede usar: 409 'El vale no tiene saldo disponible' y no se registra el cobro", async () => {
  const antes = await contar();
  for (const estado of ["EXPIRADO", "USADO"]) {
    vales.get("VAL-4F8K2A").estado = estado;
    await assert.rejects(venta(), (e) => e.status === 409 && e.message === "El vale no tiene saldo disponible", estado);
  }
  assert.equal(llamadas.filter((l) => l.url.endsWith("/usar")).length, 0);
  assert.equal(await contar(), antes);
});

test("un vale inexistente da 404 y sin codigo 400", async () => {
  await assert.rejects(venta({ codigo_vale: "VAL-NOEXIS" }), (e) => e.status === 404);
  await assert.rejects(venta({ codigo_vale: "" }), (e) => e.status === 400 && /código del vale/.test(e.message));
  await assert.rejects(venta({ codigo_vale: undefined }), (e) => e.status === 400);
});

test("si el saldo no alcanza: 422 con lo que falta y la sugerencia de pago mixto; no se registra nada", async () => {
  await assert.rejects(venta({ monto: 120 }), (e) => {
    assert.equal(e.status, 422);
    assert.match(e.message, /solo tiene Bs 80\.00.*complete los Bs 40\.00 restantes.*pago mixto/);
    assert.deepEqual([e.detalle.faltante, e.detalle.saldo_disponible, e.detalle.sugerencia], [40, 80, "PAGO_MIXTO"]);
    return true;
  });
  assert.equal(vales.get("VAL-4F8K2A").saldo, 80);
});

test("si al descontar el vale falla (el saldo cambio justo antes), la venta se DESHACE: no queda cobrada sin vale", async () => {
  const antes = await contar();
  usarFalla = 409;
  await assert.rejects(venta(), (e) => e.status === 409);
  assert.equal(await contar(), antes);
});

test("Devoluciones caida: 503 y no se registra la venta", async () => {
  const url = process.env.DEVOLUCIONES_URL;
  process.env.DEVOLUCIONES_URL = "http://localhost:1";
  try {
    await assert.rejects(venta(), (e) => e.status === 503);
  } finally {
    process.env.DEVOLUCIONES_URL = url;
  }
});

test("pago mixto: 30 Bs con vale + 20 en efectivo; el vale queda con 50 y el codigo guardado en el detalle", async () => {
  const r = registrarCreada(await registrarPagoMixto({
    cajero: CAJERO,
    total: 50,
    metodos: [{ metodo: "Vale", monto: 30, codigo_vale: "val-4f8k2a" }, { metodo: "Efectivo", monto: 20 }],
  }));
  assert.equal(vales.get("VAL-4F8K2A").saldo, 50);
  assert.deepEqual(r.detalle.map((d) => [d.metodo, d.monto, d.referencia]), [["Vale", 30, "VAL-4F8K2A"], ["Efectivo", 20, null]]);
  assert.deepEqual(llamadas.find((l) => l.url.endsWith("/usar")).cuerpo, { monto: 30, referencia: r.pago.id_transaccion });
});

test("pago mixto: Vale + Efectivo con el vale insuficiente (assigned 90 de 80) da 422 y no registra nada", async () => {
  await assert.rejects(
    registrarPagoMixto({ cajero: CAJERO, total: 100, metodos: [{ metodo: "Vale", monto: 90, codigo_vale: "VAL-4F8K2A" }, { metodo: "Efectivo", monto: 10 }] }),
    (e) => e.status === 422 && /pago mixto/.test(e.message)
  );
  assert.equal(vales.get("VAL-4F8K2A").saldo, 80);
});

test("pago mixto: si el descuento del vale falla, el pago se deshace por completo", async () => {
  const antes = await contar();
  usarFalla = 409;
  await assert.rejects(registrarPagoMixto({ cajero: CAJERO, total: 50, metodos: [{ metodo: "Vale", monto: 30, codigo_vale: "VAL-4F8K2A" }, { metodo: "QR", monto: 20 }] }), (e) => e.status === 409);
  assert.equal(await contar(), antes);
});

test("los otros metodos siguen igual y no consultan Devoluciones", async () => {
  registrarCreada(await registrarPagoSimple({ metodo: "QR", monto: 10, cajero: CAJERO }));
  assert.equal(llamadas.length, 0);
});
