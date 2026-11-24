// Simulacion de los OTROS grupos (Contabilidad D, Marketplace E, Compras C): para probar la integracion completa sin esperar a que el otro
// equipo mande algo. Cada vista "actua como" un grupo y publica por Pub/Sub REAL al topico de entrada de A1 (el de nuestra suscripcion
// ucb-sis323-sub-a1-sub) exactamente el mismo mensaje que mandaria ese grupo: nuestros servicios lo leen y lo procesan como si fuera real.
// Nunca se envian mensajes en bloque: cada accion del administrador publica UN mensaje.
const { publicar } = require("../clients/pubsubPublisher");
const repo = require("../data/pubsubVerificacionesRepo");
const { query } = require("../config/db");
const { buscarPorGrupo, slugificarOrigen, fechaDocumentoHoy } = require("../config/pubsubGrupos");
const { validarFormatoDocumento } = require("../utils/documento");
const { validarEmail } = require("../utils/email");
const { aCentavos, aMonto } = require("../utils/money");
const { AppError } = require("../utils/AppError");

const TOPICO_ENTRADA = () => buscarPorGrupo("A1").topico; // donde A1 recibe lo que mandan los demas grupos
const urlProveedores = () => process.env.PAGOS_PROVEEDORES_URL || "http://localhost:4006";

// Que grupo representa cada vista y con que identidad publica (sistema_origen)
const VISTAS = {
  contabilidad: { grupo: "D", color: "#0f766e", sistema_origen: "CONTABILIDAD", descripcion: "Contabilidad recibe nuestros asientos (facturas, notas de crédito, diferencias de caja) y responde si los registró o los rechazó." },
  marketplace: { grupo: "E", color: "#7c3aed", sistema_origen: slugificarOrigen(buscarPorGrupo("E").nombre), descripcion: "El Marketplace nos manda las ventas online de sus clientes para que las facturemos." },
  compras: { grupo: "C", color: "#b45309", sistema_origen: slugificarOrigen(buscarPorGrupo("C").nombre), descripcion: "Compras confirma que recibió nuestro reporte de productos vendidos y nos manda las órdenes de pago a proveedores." },
};

function vista(nombre) {
  const v = VISTAS[nombre];
  if (!v) throw new AppError(`La vista debe ser una de: ${Object.keys(VISTAS).join(", ")}.`, 404, { vista: nombre });
  return { nombre, ...v, grupo_info: buscarPorGrupo(v.grupo) };
}

/**
 * El contexto de una vista simulada: de que grupo es y por que topico viaja lo que se envia. En la vista del otro grupo TODO sale de ese
 * grupo (su topico, su sistema_origen) hacia el topico de A1; en la vista normal es al reves (A1 hacia el topico del grupo).
 */
function contexto(nombre) {
  const v = vista(nombre);
  const a1 = buscarPorGrupo("A1");
  return {
    vista: v.nombre,
    grupo: v.grupo,
    nombre: v.grupo_info.nombre,
    color: v.color,
    descripcion: v.descripcion,
    sistema_origen: v.sistema_origen,
    simulado: { de: { grupo: v.grupo, topico: v.grupo_info.topico }, a: { grupo: "A1", topico: TOPICO_ENTRADA() } }, // lo que pasa en esta vista
    normal: { de: { grupo: "A1", topico: a1.topico }, a: { grupo: v.grupo, topico: v.grupo_info.topico } }, // lo que pasa en Pagos y Facturacion
  };
}

/** Publica UN mensaje al topico de entrada de A1 con la identidad del grupo simulado y deja constancia en el log de verificaciones. */
async function publicarComoGrupo(nombreVista, payload, { resumen, atributos = {}, enviado_por } = {}) {
  const v = vista(nombreVista);
  const resultado = await publicar(TOPICO_ENTRADA(), payload, { origen: `simulacion_${nombreVista}`, grupo: v.grupo, ...atributos });
  const registro = await repo.registrar({
    grupo: "A1",
    grupo_origen: v.grupo,
    topico: TOPICO_ENTRADA(),
    mensaje: `[Simulación ${v.grupo_info.nombre}] ${resumen}`.slice(0, 2000),
    servicio: "gestion_pagos", tipo: atributos.tipo || `SIMULACION_${nombreVista.toUpperCase()}`, referencia: atributos.referencia_externa || null,
    payload_enviado: payload,
    ok: resultado.ok,
    message_id: resultado.ok ? resultado.messageId : null,
    error: resultado.ok ? null : resultado.error,
    enviado_por,
  });
  if (!resultado.ok) throw new AppError(`No se pudo publicar en Pub/Sub: ${resultado.error}`, 502, { registro_id: registro.id });
  return { ok: true, message_id: resultado.messageId, topico: TOPICO_ENTRADA(), registro_id: registro.id, payload };
}

// ============================================================================ Contabilidad (D)
const REFERENCIA_CONTABLE = /^(ANU-F-\d+|F-\d+|NC-\d+|DIF-\d+)$/;
const TIPOS_RESPONDIBLES = new Set(["FACTURA_VENTA", "FACTURA_ANULACION", "NOTA_CREDITO", "DIFERENCIA_CAJA"]);
const NOMBRE_TIPO = { FACTURA_VENTA: "Factura", FACTURA_ANULACION: "Anulación de factura", NOTA_CREDITO: "Nota de crédito", DIFERENCIA_CAJA: "Diferencia de caja", LOTE_CIERRE: "Lote de cierre" };

/**
 * Lo que Contabilidad "ve": los documentos que le mandamos. pendientes = enviados que aun no respondio (se pueden aceptar o rechazar);
 * respondidos = los ya resueltos (con el N de asiento o el motivo del rechazo).
 */
async function documentosContabilidad({ reunirMensajes, token } = {}) {
  const { mensajes, fuentes } = await reunirMensajes({ token });
  const docs = mensajes
    .filter((m) => m.grupo === "D")
    .map((m) => ({
      origen: m.origen,
      id: m.id,
      tipo: m.tipo,
      tipo_nombre: NOMBRE_TIPO[m.tipo] || m.tipo,
      referencia: m.referencia,
      fecha: m.fecha,
      estado: m.estado,
      resultado: m.detalle?.resultado ?? null,
      numero_asiento: m.detalle?.numero_asiento ?? null,
      motivo: m.detalle?.motivo ?? m.detalle?.motivo_rechazo ?? null,
      intentos: m.intentos ?? null,
      error: m.error ?? null,
      puede_responder: m.estado === "Enviado" && TIPOS_RESPONDIBLES.has(m.tipo) && REFERENCIA_CONTABLE.test(String(m.referencia || "")),
    }));
  return {
    pendientes: docs.filter((d) => d.puede_responder),
    // hasta 200: la vista cruza lo que acaba de responder con lo que A1 ya registro; con solo 15 los mas viejos se quedaban "procesando" para siempre
    respondidos: docs.filter((d) => d.estado === "Respondido").slice(0, 200),
    // documentos que A1 todavia NO logro entregar a Contabilidad (reintentando o con error): no tienen nada que ver con las respuestas de esta vista
    sin_enviar_lista: docs.filter((d) => d.estado === "Pendiente" || d.estado === "Error").map((d) => ({ referencia: d.referencia, tipo_nombre: d.tipo_nombre, estado: d.estado, intentos: d.intentos, error: d.error, fecha: d.fecha })),
    sin_enviar: docs.filter((d) => d.estado === "Pendiente" || d.estado === "Error").length,
    fuentes,
  };
}

/**
 * Contabilidad responde un documento nuestro (resultado_documento): "aceptado" con su N de asiento, o "rechazado" con su motivo.
 * Mismo mensaje que leen facturacion (F-/ANU-F-), devoluciones (NC-) y gestion_caja (DIF-): cada uno toma solo el suyo.
 */
// Referencias que se estan respondiendo AHORA (un doble clic o dos pestañas a la vez no pueden publicar dos mensajes del mismo documento).
const respondiendo = new Set();
const VENTANA_DUPLICADO_SEG = 20;

async function responderContabilidad({ referencia, resultado, motivo, numero_asiento, enviado_por } = {}) {
  const ref = String(referencia || "").trim();
  if (!REFERENCIA_CONTABLE.test(ref)) {
    throw new AppError("La referencia debe ser un documento nuestro: F-000123, ANU-F-000123, NC-000123 o DIF-123.", 400, { referencia });
  }
  const r = String(resultado || "").trim().toLowerCase();
  if (!["aceptado", "rechazado"].includes(r)) throw new AppError("El resultado debe ser 'aceptado' o 'rechazado'.", 400, { resultado });
  const texto = String(motivo || "").trim();
  if (r === "rechazado" && texto.length < 5) throw new AppError("Escriba el motivo del rechazo (al menos 5 caracteres).", 400, { motivo });
  if (texto.length > 400) throw new AppError("El motivo puede tener hasta 400 caracteres.", 400);
  // las notas de credito se "registran" (asi lo dice su flujo); el resto se "acepta"
  const estado = r === "aceptado" && ref.startsWith("NC-") ? "registrado" : r;
  const asiento = r === "aceptado" ? String(numero_asiento || Math.floor(Date.now() / 1000) % 1000000) : null;

  const payload = {
    sistema_origen: VISTAS.contabilidad.sistema_origen,
    tipo_mensaje: "resultado_documento",
    referencia_externa: ref,
    estado,
    numero_asiento: asiento,
    motivo: r === "rechazado" ? texto : null,
    fecha_documento: fechaDocumentoHoy(),
  };
  // UN solo mensaje por documento: si ya se esta enviando, o se envio hace unos segundos (A1 todavia lo procesa), no se publica otro.
  if (respondiendo.has(ref)) throw new AppError(`La respuesta de ${ref} ya se está enviando.`, 409, { referencia: ref });
  respondiendo.add(ref);
  try {
    const { rows } = await query(
      `SELECT 1 FROM pagos.pubsub_verificaciones
        WHERE direccion = 'ENVIADO' AND tipo = 'RESULTADO_DOCUMENTO' AND referencia = $1 AND ok AND creado_en > now() - make_interval(secs => $2)
        LIMIT 1`,
      [ref, VENTANA_DUPLICADO_SEG]
    );
    if (rows.length) throw new AppError(`Ya enviaste una respuesta para ${ref} hace instantes: A1 todavía la está procesando.`, 409, { referencia: ref });

    const enviado = await publicarComoGrupo("contabilidad", payload, {
      resumen: r === "aceptado" ? `${ref} aceptado (asiento ${asiento})` : `${ref} rechazado: ${texto}`,
      atributos: { tipo: "RESULTADO_DOCUMENTO", referencia_externa: ref },
      enviado_por,
    });
    return { ...enviado, referencia: ref, resultado: estado, numero_asiento: asiento };
  } finally {
    respondiendo.delete(ref);
  }
}

/**
 * Despues de publicar la respuesta de Contabilidad, le pide al servicio DUEÑO del documento que lea su suscripcion YA (facturas y anulaciones:
 * Facturacion; notas de credito: Devoluciones; diferencias de caja: Gestion de Caja). Sin esto cada servicio la leia solo cada 30 s y, como la
 * suscripcion es compartida, la respuesta podia tardar hasta un minuto en registrarse. Se reintenta 2 veces mas por si la primera lectura
 * se llevo otros mensajes. La primera lectura espera unos segundos para que el mensaje se pueda ver en el topico. Nunca falla: si no se puede despertar al servicio, su reloj de 30 s la procesa igual.
 */
function despertarLectorContabilidad(referencia, token) {
  const ref = String(referencia || "");
  const base = /^(?:ANU-)?F-/.test(ref)
    ? `${process.env.FACTURACION_URL || "http://localhost:4002"}/api/facturas/respuestas-contabilidad/procesar`
    : /^NC-/.test(ref)
      ? `${process.env.DEVOLUCIONES_URL || "http://localhost:4007"}/api/integraciones/respuestas-contabilidad/procesar`
      : /^DIF-/.test(ref)
        ? `${process.env.GESTION_CAJA_URL || "http://localhost:4004"}/api/caja/diferencias/respuestas-contabilidad/procesar`
        : null;
  if (!base || !token) return;
  // El mensaje queda en el topico de A1 (suscripcion compartida) hasta que el servicio dueño lo lee y lo confirma. Si se lee a los 1,5 s, quien este
  // mirando el topico (el docente) no alcanza a verlo. Por eso la primera lectura espera VISIBILIDAD_SEG (por defecto 40 s; 0 = al instante).
  const visible = Number(process.env.SIMULACION_CONTABILIDAD_VISIBLE_SEG ?? 40) * 1000;
  for (const espera of [1500, 6000, 15000].map((e) => e + visible)) {
    setTimeout(() => {
      fetch(base, { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }).catch(() => {});
    }, espera).unref();
  }
}

/**
 * Detalle de un documento de la bandeja de Contabilidad: lo que A1 le envio, para saber que se esta aceptando o rechazando.
 * Facturas y anulaciones traen ademas la factura completa (cliente, NIT, productos, metodo de pago); notas de credito, diferencias y lotes,
 * los datos del mensaje enviado. 404 si Contabilidad no tiene ese documento.
 */
async function detalleDocumentoContabilidad({ referencia, reunirMensajes, token } = {}) {
  const ref = String(referencia || "").trim();
  if (!ref) throw new AppError("Indique la referencia del documento.", 400);
  const { mensajes } = await reunirMensajes({ token });
  const m = mensajes.find((x) => x.grupo === "D" && x.referencia === ref);
  if (!m) throw new AppError(`Contabilidad no tiene el documento ${ref}.`, 404, { referencia: ref });

  const detalle = {
    referencia: ref,
    tipo: m.tipo,
    tipo_nombre: NOMBRE_TIPO[m.tipo] || m.tipo,
    estado: m.estado,
    enviado_en: m.fecha,
    message_id: m.message_id ?? null,
    intentos: m.intentos ?? null,
    servicio_origen: m.origen,
    resultado: m.detalle?.resultado ?? null,
    numero_asiento: m.detalle?.numero_asiento ?? null,
    motivo: m.detalle?.motivo ?? m.detalle?.motivo_rechazo ?? null,
    datos: m.datos ?? null,
    extra: m.detalle ?? null,
    factura: null,
  };

  const numeroFactura = /^(?:ANU-)?(F-\d+)$/.exec(ref)?.[1];
  if (numeroFactura) {
    try {
      const r = await fetch(`${process.env.FACTURACION_URL || "http://localhost:4002"}/api/facturas/${encodeURIComponent(numeroFactura)}`, { signal: AbortSignal.timeout(5000) });
      const f = r.ok ? (await r.json()).data : null;
      if (f) {
        detalle.factura = {
          numero: f.numero,
          fecha: f.fecha,
          estado: f.estado,
          cliente_nombre: f.cliente_nombre ?? null,
          cliente_nit: f.cliente_nit ?? null,
          total: Number(f.total) || 0,
          items: (f.items ?? []).map((it) => ({ descripcion: it.descripcion, cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), subtotal: Number(it.subtotal) })),
          metodos_pago: (f.metodosPago ?? []).map((p) => ({ metodo: p.metodo, monto: Number(p.monto) })),
        };
      }
    } catch {
      // sin Facturacion se muestra el resto del detalle
    }
  }
  return detalle;
}

// ============================================================================ Marketplace (E)
const CATALOGO = [
  { sku: "ARR-001", descripcion: "Arroz Grano de Oro 10 kg", precio: 95, categoria: "Abarrotes" },
  { sku: "ACE-002", descripcion: "Aceite Fino vegetal 900 ml", precio: 15, categoria: "Abarrotes" },
  { sku: "AZU-003", descripcion: "Azúcar Aguaí 1 kg", precio: 7.5, categoria: "Abarrotes" },
  { sku: "FID-004", descripcion: "Fideo Don Vittorio spaghetti 400 g", precio: 6.5, categoria: "Abarrotes" },
  { sku: "LEC-005", descripcion: "Leche PIL ultrapasteurizada 1 L", precio: 7, categoria: "Lácteos" },
  { sku: "QUE-006", descripcion: "Queso criollo Esthercita", precio: 25, categoria: "Lácteos" },
  { sku: "HUE-007", descripcion: "Huevos La Granja (maple de 30)", precio: 32, categoria: "Frescos" },
  { sku: "PAN-008", descripcion: "Pan de molde San Gabriel", precio: 14.5, categoria: "Panadería" },
  { sku: "ATU-009", descripcion: "Atún El Pescador 170 g", precio: 12, categoria: "Conservas" },
  { sku: "CAF-010", descripcion: "Café Copacabana premium molido", precio: 28, categoria: "Bebidas" },
  { sku: "JUG-011", descripcion: "Bebida de naranja De la Granja 3 L", precio: 24, categoria: "Bebidas" },
  { sku: "DET-012", descripcion: "Detergente Bolivar 1 kg", precio: 22.5, categoria: "Limpieza" },
];
const METODOS = ["Efectivo", "Tarjeta", "QR"];
const MAX_UNIDADES = 50;

const listarProductosMarketplace = () => CATALOGO;

/**
 * El Marketplace manda una venta online: el administrador elige productos y cantidades, y el servidor calcula el total (nunca se confia en
 * el que mande el cliente). El mensaje es el mismo que ya valida recibirVenta: ordenId, nit, items, total, metodoPago...
 */
async function enviarVentaMarketplace({ items, nit, tipo_documento, razon_social, email, metodo_pago, enviado_por, alPublicar } = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new AppError("Elija al menos un producto.", 400);
  const vistos = new Set();
  const detalle = items.map((it) => {
    const p = CATALOGO.find((x) => x.sku === String(it?.sku || "").trim());
    if (!p) throw new AppError(`El producto "${it?.sku}" no está en el catálogo del Marketplace.`, 400, { sku: it?.sku });
    if (vistos.has(p.sku)) throw new AppError(`El producto ${p.sku} está repetido: sume la cantidad en una sola fila.`, 400);
    vistos.add(p.sku);
    const cantidad = Number(it.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_UNIDADES) {
      throw new AppError(`La cantidad de ${p.descripcion} debe ser un entero entre 1 y ${MAX_UNIDADES}.`, 400, { sku: p.sku, cantidad: it.cantidad });
    }
    return { sku: p.sku, descripcion: p.descripcion, cantidad, precioUnitario: p.precio };
  });

  const tipoDocumento = String(tipo_documento || "NIT").toUpperCase();
  const errorDoc = validarFormatoDocumento(tipoDocumento, String(nit ?? "").trim());
  if (errorDoc) throw new AppError(errorDoc, 400, { nit });
  const razon = String(razon_social || "").trim();
  if (!razon) throw new AppError("Escriba el nombre o razón social del cliente.", 400);
  const correo = String(email || "").trim();
  if (correo) {
    const e = validarEmail(correo);
    if (e) throw new AppError(e, 400, { email });
  }
  const metodo = metodo_pago || "QR";
  if (!METODOS.includes(metodo)) throw new AppError(`El método de pago debe ser uno de: ${METODOS.join(", ")}.`, 400, { metodo_pago });

  const total = aMonto(detalle.reduce((a, it) => a + aCentavos(it.cantidad * it.precioUnitario), 0));
  const ordenId = `MKT-SIM-${Date.now().toString(36).toUpperCase()}`;
  const payload = {
    sistema_origen: VISTAS.marketplace.sistema_origen,
    ordenId,
    cliente: razon,
    nit: String(nit).trim(),
    tipoDocumento,
    razonSocial: razon,
    ...(correo ? { email: correo } : {}),
    metodoPago: metodo,
    items: detalle,
    total,
  };
  const enviado = await publicarComoGrupo("marketplace", payload, {
    resumen: `Venta ${ordenId}: ${detalle.length} producto(s), Bs ${total.toFixed(2)}`,
    atributos: { tipo: "VENTA_ONLINE", referencia_externa: ordenId },
    enviado_por,
  });
  if (alPublicar) alPublicar(); // p. ej. leer la suscripcion en seguida, sin esperar al reloj del job
  return { ...enviado, orden_id: ordenId, total, items: detalle.length };
}

/** Las ultimas ventas online recibidas (lo que "ya aparece" en Pagos y Facturacion tras el envio). */
async function ventasMarketplaceRecientes() {
  const { rows } = await query(
    `SELECT v.orden_id, v.total::float AS total, v.metodo_pago, v.estado, v.recibida_en, v.numero_factura, v.razon_social,
            (SELECT COUNT(*)::int FROM pagos.venta_online_items i WHERE i.venta_id = v.id) AS productos
       FROM pagos.ventas_online v
      ORDER BY v.recibida_en DESC, v.id DESC
      LIMIT 10`
  );
  return rows;
}

// ============================================================================ Compras (C)
const REFERENCIA_REPORTE = /^PV-\d{4}-\d{2}-\d{2}$/;
const PROVEEDORES = [
  { id: "andina", nit: "1020304050", razonSocial: "Distribuidora Andina S.R.L.", cuentaBancaria: "10000012345", banco: "Banco Unión" },
  { id: "sur", nit: "1033445566", razonSocial: "Insumos del Sur S.A.", cuentaBancaria: "20000067890", banco: "Banco Mercantil Santa Cruz" },
  { id: "oriente", nit: "1044556677", razonSocial: "Importadora Oriente Ltda.", cuentaBancaria: "30000023456", banco: "Banco Nacional de Bolivia" },
  { id: "valle", nit: "1055667788", razonSocial: "Lácteos del Valle S.A.", cuentaBancaria: "40000034567", banco: "Banco BISA" },
];

const listarProveedores = () => PROVEEDORES;

/** Los reportes de productos vendidos que le mandamos a Compras y si ya los confirmo. */
async function reportesCompras() {
  const { rows } = await query(
    `SELECT reporte_id, fecha::text AS fecha, estado, intentos, COALESCE(enviado_en, creado_en) AS enviado_en, recibido_en
       FROM pagos.envios_compras ORDER BY fecha DESC LIMIT 15`
  );
  return rows.map((r) => ({ ...r, puede_acusar: r.estado === "Enviado" }));
}

/** Compras confirma que recibio nuestro reporte (acuse): el mismo mensaje que lee el job de acuses y marca el envio como Recibido. */
async function acusarCompras({ reporte_id, enviado_por, alPublicar } = {}) {
  const id = String(reporte_id || "").trim();
  if (!REFERENCIA_REPORTE.test(id)) throw new AppError("El reporte debe tener la forma PV-AAAA-MM-DD.", 400, { reporte_id });
  const { rows } = await query(`SELECT estado FROM pagos.envios_compras WHERE reporte_id = $1`, [id]);
  if (!rows[0]) throw new AppError(`No enviamos el reporte ${id} a Compras.`, 404, { reporte_id: id });
  if (rows[0].estado === "Recibido") throw new AppError(`Compras ya confirmó el reporte ${id}.`, 409, { reporte_id: id });
  if (rows[0].estado !== "Enviado") throw new AppError(`El reporte ${id} todavía no salió hacia Compras (está ${rows[0].estado}).`, 409, { reporte_id: id });

  const payload = {
    origen: "compras",
    sistema_origen: VISTAS.compras.sistema_origen,
    tipo_mensaje: "acuse_productos_vendidos",
    reporte_id: id,
    fecha_documento: fechaDocumentoHoy(),
  };
  const enviado = await publicarComoGrupo("compras", payload, { resumen: `Acuse del reporte ${id}`, atributos: { tipo: "ACUSE_COMPRAS", referencia_externa: id }, enviado_por });
  if (alPublicar) alPublicar();
  return { ...enviado, reporte_id: id };
}

/** Compras manda una orden de pago aprobada: se PUBLICA por Pub/Sub al topico de A1 y Pagos a Proveedores la lee de su suscripcion. */
async function enviarOrdenCompras({ proveedor_id, monto, concepto, dias_vencimiento, enviado_por } = {}) {
  const proveedor = PROVEEDORES.find((p) => p.id === proveedor_id);
  if (!proveedor) throw new AppError(`El proveedor debe ser uno de: ${PROVEEDORES.map((p) => p.id).join(", ")}.`, 400, { proveedor_id });
  const m = Number(monto);
  if (!Number.isFinite(m) || m <= 0 || m > 10_000_000 || Math.round(m * 100) / 100 !== m) {
    throw new AppError("El monto debe ser un número mayor a 0 (hasta 2 decimales).", 400, { monto });
  }
  const dias = dias_vencimiento === undefined || dias_vencimiento === "" ? 30 : Number(dias_vencimiento);
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw new AppError("Los días de vencimiento deben ser un entero entre 1 y 365.", 400, { dias_vencimiento });
  const texto = String(concepto || "").trim() || "Compra de mercadería (simulación de Compras)";
  if (texto.length > 200) throw new AppError("El concepto puede tener hasta 200 caracteres.", 400);

  const sufijo = Date.now().toString(36).toUpperCase();
  const vence = new Date(Date.now() + dias * 86400000).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });
  const orden = {
    numero: `OP-SIM-${sufijo}`,
    ordenCompraId: `OC-SIM-${sufijo}`,
    monto: m,
    proveedor: { nit: proveedor.nit, razonSocial: proveedor.razonSocial, cuentaBancaria: proveedor.cuentaBancaria, banco: proveedor.banco },
    fechaVencimiento: vence,
    concepto: texto,
  };
  const payload = {
    sistema_origen: VISTAS.compras.sistema_origen,
    tipo_operacion: "orden_pago",
    referencia_externa: orden.numero,
    fecha_documento: fechaDocumentoHoy(),
    datos: orden,
  };
  const enviado = await publicarComoGrupo("compras", payload, {
    resumen: `Orden de pago ${orden.numero}: ${proveedor.razonSocial} por Bs ${m}`,
    atributos: { tipo: "ORDEN_PAGO", tipo_operacion: "orden_pago", referencia_externa: orden.numero },
    enviado_por,
  });
  return { ...enviado, numero: orden.numero, orden_compra_id: orden.ordenCompraId, proveedor: proveedor.razonSocial, monto: m, vence };
}

/** Las ordenes pendientes que ve Pagos a Proveedores (lo que Compras ya nos entrego). */
async function ordenesPendientesCompras() {
  try {
    const r = await fetch(`${urlProveedores()}/api/proveedores/ordenes/pendientes`, { signal: AbortSignal.timeout(5000) });
    const cuerpo = await r.json().catch(() => null);
    if (!r.ok) return { ordenes: [], error: cuerpo?.mensaje || `Pagos a Proveedores respondió HTTP ${r.status}` };
    return { ordenes: (cuerpo?.data || []).slice(0, 10), error: null };
  } catch {
    return { ordenes: [], error: "No se pudo conectar con Pagos a Proveedores" };
  }
}

module.exports = {
  despertarLectorContabilidad,
  VISTAS, contexto, documentosContabilidad, detalleDocumentoContabilidad, responderContabilidad, REFERENCIA_CONTABLE,
  listarProductosMarketplace, enviarVentaMarketplace, ventasMarketplaceRecientes, CATALOGO,
  reportesCompras, acusarCompras, listarProveedores, enviarOrdenCompras, ordenesPendientesCompras,
};
