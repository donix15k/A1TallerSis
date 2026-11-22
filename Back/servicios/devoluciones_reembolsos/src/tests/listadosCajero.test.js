// Listados del cajero: facturas con su vigencia de 7 dias (Nueva devolucion), devoluciones recientes (lateral) y cupones generados.
// Facturacion "de mentira"; base de devoluciones REAL (los datos de prueba se borran al final).
const test = require("node:test");
const assert = require("node:assert/strict");
const { query } = require("../config/db");
const { iniciarEntorno } = require("./helpers/entorno");

let entorno;
const creadas = [];
const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

test.before(async () => {
  entorno = await iniciarEntorno();
});
test.after(async () => {
  for (const codigo of creadas) await query(`DELETE FROM devoluciones.devoluciones WHERE codigo = $1`, [codigo]);
  await entorno.cerrar();
});

test("Nueva devolucion: lista las facturas (la mas reciente primero) con codigo, vigencia de 7 dias y si se pueden devolver", async () => {
  const vigente = entorno.agregarFactura(9101, { fecha: hace(1) });
  const limite = entorno.agregarFactura(9102, { fecha: hace(7) });
  const vencida = entorno.agregarFactura(9103, { fecha: hace(20) });
  const anulada = entorno.agregarFactura(9104, { fecha: hace(2), estado: "Anulada" });

  const r = await entorno.get("/api/devoluciones/facturas?por_pagina=50");
  assert.equal(r.status, 200);
  const por = Object.fromEntries(r.cuerpo.data.map((f) => [f.numero, f]));
  assert.deepEqual([por[vigente].dentro_de_plazo, por[vigente].devolvible, por[vigente].dias_restantes], [true, true, 6]);
  assert.deepEqual([por[limite].dentro_de_plazo, por[limite].devolvible, por[limite].dias_restantes], [true, true, 0]); // el 7mo dia todavia se puede
  assert.deepEqual([por[vencida].dentro_de_plazo, por[vencida].devolvible, por[vencida].dias_restantes], [false, false, 0]);
  assert.deepEqual([por[anulada].dentro_de_plazo, por[anulada].devolvible], [true, false]); // anulada: dentro del plazo pero no se devuelve
  const orden = r.cuerpo.data.map((f) => f.numero);
  assert.ok(orden.indexOf(vigente) < orden.indexOf(limite) && orden.indexOf(limite) < orden.indexOf(vencida), "la mas reciente primero");
});

test("Nueva devolucion: busca entre todas (numero, cliente, NIT/CI) y pagina", async () => {
  const nuevas = [];
  for (let i = 0; i < 12; i++) nuevas.push(entorno.agregarFactura(9200 + i, { fecha: hace(1) }));
  const p1 = await entorno.get("/api/devoluciones/facturas?por_pagina=5&pagina=1");
  assert.equal(p1.cuerpo.data.length, 5);
  assert.ok(p1.cuerpo.total >= 12 && p1.cuerpo.total_paginas >= 3);
  const p2 = await entorno.get("/api/devoluciones/facturas?por_pagina=5&pagina=2");
  assert.notEqual(p2.cuerpo.data[0].numero, p1.cuerpo.data[0].numero);

  const busca = await entorno.get(`/api/devoluciones/facturas?q=${encodeURIComponent(nuevas[5])}`);
  assert.deepEqual(busca.cuerpo.data.map((f) => f.numero), [nuevas[5]]);
  assert.equal((await entorno.get("/api/devoluciones/facturas?q=zzz-no-existe")).cuerpo.data.length, 0);
});

test("Recientes: las devoluciones mas nuevas primero, 10 por pagina", async () => {
  const r = await entorno.get("/api/devoluciones/recientes");
  assert.equal(r.status, 200);
  assert.ok(r.cuerpo.data.length <= 10);
  assert.equal(r.cuerpo.por_pagina, 10);
  const codigos = r.cuerpo.data.map((d) => Number(d.codigo.replace("DEV-", "")));
  assert.deepEqual(codigos, [...codigos].sort((a, b) => b - a), "de la mas reciente a la mas antigua");
  for (const d of r.cuerpo.data) assert.ok(d.estado && d.factura_numero && d.fecha_solicitud);
  const p2 = await entorno.get("/api/devoluciones/recientes?pagina=2&por_pagina=1");
  assert.equal(p2.cuerpo.data.length <= 1, true);
});

test("Cupones generados: cada vale con cliente, fecha y hora, monto y estado; la busqueda filtra", async () => {
  const numero = entorno.agregarFactura(9301, { fecha: hace(1) });
  const { rows } = await query(
    `INSERT INTO devoluciones.devoluciones (codigo, factura_numero, venta_id, cliente_nit, fecha_venta, dentro_de_plazo, metodo_pago_original, tipo, monto_total, estado, creado_por, origen)
     VALUES ($1, $2, 1, '1234567', now(), true, 'Efectivo', 'PARCIAL', 120, 'PROCESADA', 'cajero.prueba', 'TIENDA') RETURNING id`,
    [`DEV-T${String(Date.now()).slice(-6)}`, numero]
  );
  const devId = rows[0].id;
  const cod = (await query(`SELECT codigo FROM devoluciones.devoluciones WHERE id = $1`, [devId])).rows[0].codigo;
  creadas.push(cod);
  const codigoVale = `VAL-T${String(Date.now()).slice(-5)}`;
  await query(`INSERT INTO devoluciones.vales_compra (devolucion_id, codigo, monto, saldo_disponible, expira_en) VALUES ($1, $2, 120, 120, now() + interval '90 days')`, [devId, codigoVale]);

  const r = await entorno.get(`/api/vales?q=${codigoVale}`);
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.data.length, 1);
  const c = r.cuerpo.data[0];
  assert.deepEqual([c.codigo, c.estado, c.monto, c.saldo_disponible, c.devolucion_codigo, c.factura_numero], [codigoVale, "ACTIVO", 120, 120, cod, numero]);
  assert.equal(c.cliente_nombre, "Cliente de prueba"); // el nombre sale de la factura
  assert.equal(c.cliente_nit, "1234567");
  assert.ok(c.emitido_en && c.vence_en);

  const todos = await entorno.get("/api/vales?por_pagina=50");
  assert.equal(todos.cuerpo.data[0].codigo, codigoVale, "el mas reciente primero");
  assert.equal((await entorno.get("/api/vales?q=VAL-NO-EXISTE")).cuerpo.data.length, 0);
});
