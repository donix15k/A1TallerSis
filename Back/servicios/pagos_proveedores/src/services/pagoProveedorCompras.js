// Confirmacion a Compras (Grupo C) de que se pago a un proveedor: un mensaje Pub/Sub en su topico, con el MISMO sobre que usan las ordenes de pago que ellos
// nos mandan (sistema_origen / tipo_operacion / referencia_externa / fecha_documento / datos). Es un envio nuevo: no usa el canal HTTP de confirmaciones
// (confirmacionPagoService.js) ni ninguna otra integracion. Una confirmacion por orden; si falla queda en Error y se puede reenviar.
const { query } = require("../config/db");
const { registrarEnvio } = require("../utils/pubsubLog");
const { publicarEnCompras } = require("../clients/comprasPagoPublisher");
const { AppError } = require("../utils/AppError");

// Somos el grupo A1 (mismo valor que usan los demas mensajes que enviamos).
const SISTEMA_ORIGEN = "GESTION_DE_PAGOS_Y_FACTURACION";
const fechaBolivia = (v) => new Date(v).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });

/** La orden completa (proveedor, banco, cuenta, monto, concepto) y su egreso, para armar el mensaje. */
async function datosDeLaOrden(numero) {
  const { rows } = await query(
    `SELECT o.id, o.numero, o.orden_compra_id, o.proveedor_nit, o.proveedor_razon_social, o.proveedor_cuenta_bancaria, o.proveedor_banco, o.monto, o.moneda, o.concepto,
            o.estado, o.liquidada_en, o.liquidada_por,
            e.metodo, e.descripcion, e.registrado_por, e.registrado_en
       FROM proveedores.ordenes_pago o
       LEFT JOIN LATERAL (SELECT metodo, descripcion, registrado_por, registrado_en FROM proveedores.egresos WHERE orden_pago_id = o.id ORDER BY id DESC LIMIT 1) e ON true
      WHERE o.numero = $1`,
    [numero]
  );
  return rows[0] || null;
}

/** El mensaje "pago_proveedor_confirmado": el mismo sobre que la orden de pago que nos mando Compras, ahora con el pago realizado. */
function armarMensajePago(o) {
  const pagadoEn = o.registrado_en || o.liquidada_en || new Date();
  return {
    sistema_origen: SISTEMA_ORIGEN,
    tipo_operacion: "pago_proveedor_confirmado",
    referencia_externa: o.numero,
    fecha_documento: fechaBolivia(pagadoEn),
    datos: {
      numero: o.numero,
      ordenCompraId: o.orden_compra_id,
      estado: "pagado",
      monto: Number(o.monto),
      moneda: o.moneda || "BOB",
      concepto: o.concepto || null,
      proveedor: { nit: o.proveedor_nit, razonSocial: o.proveedor_razon_social, banco: o.proveedor_banco, cuentaBancaria: o.proveedor_cuenta_bancaria },
      metodoPago: o.metodo || null,
      descripcion: o.descripcion || null,
      pagadoPor: o.registrado_por || o.liquidada_por || null,
      pagadoEn: new Date(pagadoEn).toISOString(),
    },
  };
}

/**
 * Publica la confirmacion de pago de una orden LIQUIDADA. Si ya se envio (Enviado) no se repite. Nunca lanza: devuelve { enviada, estado, messageId?, error? }.
 */
async function confirmarPagoACompras(numero) {
  try {
    const o = await datosDeLaOrden(numero);
    if (!o) throw new AppError(`La orden "${numero}" no existe.`, 404);
    if (o.estado !== "LIQUIDADA") throw new AppError(`La orden ${numero} todavia no esta pagada.`, 409);

    const { rows: previa } = await query(`SELECT estado, pubsub_message_id FROM proveedores.confirmaciones_pago_pubsub WHERE orden_pago_id = $1`, [o.id]);
    if (previa[0]?.estado === "Enviado") return { enviada: true, yaEnviada: true, estado: "Enviado", messageId: previa[0].pubsub_message_id };

    const payload = armarMensajePago(o);
    const r = await publicarEnCompras(payload, {
      tipo: "PAGO_PROVEEDOR_CONFIRMADO",
      tipo_operacion: payload.tipo_operacion,
      referencia_externa: payload.referencia_externa,
      idempotency_key: `pago-${payload.referencia_externa}`,
      origen: "pagos_proveedores",
      grupo: "A1",
    });
    if (r.topico) {
      await registrarEnvio({ servicio: "pagos_proveedores", tipo: "PAGO_PROVEEDOR_CONFIRMADO", referencia: payload.referencia_externa, topico: r.topico, payload, ok: r.ok, messageId: r.messageId, error: r.error, por: payload.datos.pagadoPor });
    }
    if (!r.topico) return { enviada: false, estado: "SinConfigurar", error: r.error }; // sin topico no se registra nada: al configurarlo se puede reenviar
    await query(
      `INSERT INTO proveedores.confirmaciones_pago_pubsub (orden_pago_id, estado, pubsub_message_id, error, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (orden_pago_id) DO UPDATE SET estado = EXCLUDED.estado, pubsub_message_id = EXCLUDED.pubsub_message_id, error = EXCLUDED.error,
                                                payload = EXCLUDED.payload, intentos = proveedores.confirmaciones_pago_pubsub.intentos + 1, enviado_en = now()`,
      [o.id, r.ok ? "Enviado" : "Error", r.ok ? r.messageId : null, r.ok ? null : r.error, JSON.stringify(payload)]
    );
    return r.ok ? { enviada: true, estado: "Enviado", messageId: r.messageId } : { enviada: false, estado: "Error", error: r.error };
  } catch (e) {
    console.error(`[compras] No se pudo confirmar el pago de ${numero}:`, e.message);
    return { enviada: false, estado: "Error", error: e.message };
  }
}

module.exports = { confirmarPagoACompras, armarMensajePago };
