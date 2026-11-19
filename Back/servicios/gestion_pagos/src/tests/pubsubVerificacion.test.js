// TDSI-958: pantalla "Verificacion de Pub/Sub" del Administrador.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { query, pool } = require("../config/db");
const { errorHandler } = require("../middlewares/errorHandler");
const publisher = require("../clients/pubsubPublisher");
const { enviarVerificacion, listarVerificaciones, listarGrupos } = require("../services/pubsubVerificacionService");

const publicados = [];
const topicoQuePublicaBien = () => ({
  topic: () => ({ publishMessage: async (msg) => { publicados.push(msg); return `pub-${publicados.length}`; } }),
});
const topicoQueFalla = (motivo) => ({ topic: () => ({ publishMessage: async () => { throw new Error(motivo); } }) });

let servidor, base;

test.before(async () => {
  publisher.usarClienteDePrueba(topicoQuePublicaBien());
  const app = express();
  app.use(express.json());
  app.use("/api/pagos", require("../routes/pubsubVerificacionRoutes"));
  app.use(errorHandler);
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://localhost:${servidor.address().port}/api/pagos`;
});

test.after(async () => {
  servidor.close();
  publisher.usarClienteDePrueba(null);
  await query(`DELETE FROM pagos.pubsub_verificaciones WHERE mensaje LIKE 'TEST-TDSI-958%'`);
  await pool.end();
});

test("TDSI-958: listarGrupos trae los grupos del proyecto (A a I, mas los topicos A1 y A2) con su topico armado", () => {
  const grupos = listarGrupos();
  assert.equal(grupos.length, 11);
  assert.deepEqual(grupos.map((g) => g.grupo), ["A", "A1", "A2", "B", "C", "D", "E", "F", "G", "H", "I"]);
  const a = grupos.find((g) => g.grupo === "A");
  assert.equal(a.topico, "projects/project-a96e5fe1-5ba6-4698-a85/topics/ucb-sis323-sub-a");
  // los dos topicos agregados: nombres exactos que dio el docente
  assert.equal(grupos.find((g) => g.grupo === "A1").topico, "projects/project-a96e5fe1-5ba6-4698-a85/topics/ucb-sis323-sub-a1");
  assert.equal(grupos.find((g) => g.grupo === "A2").topico, "projects/project-a96e5fe1-5ba6-4698-a85/topics/ucb-sis323-sub-a2");
});

test("los topicos A1 y A2 se pueden usar como destino de una verificacion (con el publicador de prueba)", async () => {
  for (const grupo of ["A1", "a2"]) {
    const registro = await enviarVerificacion({ grupo, mensaje: `TEST-TDSI-958 a ${grupo}` });
    assert.equal(registro.ok, true);
    assert.equal(registro.topico, `projects/project-a96e5fe1-5ba6-4698-a85/topics/ucb-sis323-sub-${grupo.toLowerCase()}`);
  }
});

test("TDSI-958: rechaza un grupo invalido, un mensaje vacio y uno demasiado largo", async () => {
  await assert.rejects(() => enviarVerificacion({ grupo: "Z", mensaje: "hola" }), /grupo/i);
  await assert.rejects(() => enviarVerificacion({ grupo: "A", mensaje: "   " }), /mensaje/i);
  await assert.rejects(() => enviarVerificacion({ grupo: "A", mensaje: "x".repeat(2001) }), /2000/);
});

test("TDSI-958/960: una verificacion exitosa (origen A1 por defecto) queda registrada con su message_id, el payload enviado y aparece en el log", async () => {
  const registro = await enviarVerificacion({ grupo: "a", mensaje: "TEST-TDSI-958 hola", enviado_por: "admin-test@correo.test" });
  assert.equal(registro.grupo, "A");
  assert.equal(registro.grupo_origen, "A1");
  assert.equal(registro.ok, true);
  assert.ok(registro.message_id);
  assert.equal(registro.error, null);
  assert.equal(registro.enviado_por, "admin-test@correo.test");

  // TDSI-960/961: lo publicado no es el texto suelto -- va envuelto siempre en el
  // mismo sobre que ya usan facturacion/gestion_caja con Contabilidad
  // (sistema_origen/referencia_externa/tipo_operacion/fecha_documento/datos).
  assert.equal(registro.payload_enviado.sistema_origen, "GESTION_DE_PAGOS_Y_FACTURACION");
  assert.match(registro.payload_enviado.referencia_externa, /^VERIF-\d+$/);
  assert.equal(registro.payload_enviado.tipo_operacion, "verificacion_manual");
  assert.match(registro.payload_enviado.fecha_documento, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(registro.payload_enviado.datos.mensaje, "TEST-TDSI-958 hola");
  assert.equal(registro.payload_enviado.datos.enviado_por_email, "admin-test@correo.test");

  // TDSI-963: el atributo grupo sigue el origen elegido (A1 por defecto: somos el grupo A1).
  const ultimo = publicados.at(-1);
  assert.equal(ultimo.attributes.grupo, "A1");
  assert.equal(ultimo.attributes.origen, "gestion_pagos");
  assert.equal(ultimo.attributes.referencia_externa, registro.payload_enviado.referencia_externa);
  assert.deepEqual(ultimo.json, registro.payload_enviado);

  const log = await listarVerificaciones();
  assert.ok(log.some((r) => r.id === registro.id));
});

test("TDSI-963: se puede simular que el mensaje viene de otro grupo (grupo_origen)", async () => {
  const registro = await enviarVerificacion({ grupo_origen: "d", grupo: "I", mensaje: "TEST-TDSI-958 desde D hacia I" });
  assert.equal(registro.grupo, "I");
  assert.equal(registro.grupo_origen, "D");
  assert.equal(registro.payload_enviado.sistema_origen, "CONTABILIDAD");

  const ultimo = publicados.at(-1);
  assert.equal(ultimo.attributes.grupo, "D");
});

test("TDSI-963: un grupo_origen invalido responde 400", async () => {
  await assert.rejects(() => enviarVerificacion({ grupo_origen: "Z", grupo: "A", mensaje: "hola" }), /grupo origen/i);
});

test("TDSI-958: si Pub/Sub falla, queda registrado ok=false con el error (no se pierde el intento)", async () => {
  publisher.usarClienteDePrueba(topicoQueFalla("el grupo B no existe"));
  try {
    const registro = await enviarVerificacion({ grupo: "B", mensaje: "TEST-TDSI-958 chau" });
    assert.equal(registro.ok, false);
    assert.equal(registro.message_id, null);
    assert.match(registro.error, /el grupo B no existe/);
  } finally {
    publisher.usarClienteDePrueba(topicoQuePublicaBien());
  }
});

test("TDSI-962: topico_personalizado manda al topico exacto indicado (no a ninguno de los grupos conocidos) y queda como grupo CUSTOM", async () => {
  const topicoDePrueba = "projects/project-a96e5fe1-5ba6-4698-a85/topics/topico-de-prueba-cualquiera";
  const registro = await enviarVerificacion({ topico_personalizado: topicoDePrueba, mensaje: "TEST-TDSI-958 personalizado" });
  assert.equal(registro.grupo, "CUSTOM");
  assert.equal(registro.topico, topicoDePrueba);
  assert.equal(registro.ok, true);
});

test("TDSI-962: un topico_personalizado con formato invalido responde 400", async () => {
  await assert.rejects(
    () => enviarVerificacion({ topico_personalizado: "esto-no-es-un-topico-valido", mensaje: "hola" }),
    /projects\/.*\/topics\//
  );
});

test("TDSI-958: rutas HTTP -- GET /grupos, POST valida y registra, GET trae el log", async () => {
  const rGrupos = await fetch(`${base}/pubsub-verificacion/grupos`);
  assert.equal(rGrupos.status, 200);
  assert.equal((await rGrupos.json()).data.length, 11);

  const rMala = await fetch(`${base}/pubsub-verificacion`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grupo: "A", mensaje: "" }),
  });
  assert.equal(rMala.status, 400);

  const rOk = await fetch(`${base}/pubsub-verificacion`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grupo: "E", mensaje: "TEST-TDSI-958 por ruta" }),
  });
  assert.equal(rOk.status, 200);
  const { data } = await rOk.json();
  assert.equal(data.ok, true);

  const rLog = await fetch(`${base}/pubsub-verificacion`);
  const { data: log } = await rLog.json();
  assert.ok(log.some((r) => r.id === data.id));
});
