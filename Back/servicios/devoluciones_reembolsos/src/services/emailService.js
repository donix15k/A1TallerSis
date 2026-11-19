const nodemailer = require("nodemailer");

// Mismo criterio que Gestion de Pagos: sin SMTP_HOST/SMTP_USER/SMTP_PASS en el .env el correo se "simula" (se
// deja constancia del envio pero no sale nada); con credenciales se envia de verdad.
// Solo para pruebas: reemplaza el transportador real (null fuerza "simulado"; undefined vuelve al real).
let transportadorPrueba;

function transportadorConfigurado() {
  if (transportadorPrueba !== undefined) return transportadorPrueba;
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function usarTransportadorDePrueba(falso) {
  transportadorPrueba = falso;
}

function htmlNota({ nota, devolucion, empresa }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color:#1f2933;">
      <h2 style="color:#06152F; margin-bottom:0;">${empresa.nombre}</h2>
      <p style="color:#616e7c; margin-top:0.25rem;">${empresa.direccion}</p>
      <hr style="border:none; border-top:1px solid #e4e7eb;" />
      <p>Adjuntamos su <strong>nota de crédito ${nota.numero}</strong> por la devolución <strong>${devolucion.codigo}</strong> de la factura ${devolucion.factura_numero}.</p>
      <p style="font-size:1.2rem; font-weight:bold;">Monto acreditado: Bs. ${nota.monto.toFixed(2)}</p>
      <hr style="border:none; border-top:1px solid #e4e7eb;" />
      <p style="color:#616e7c; font-size:0.85rem;">Gracias por su preferencia.</p>
    </div>
  `;
}

/**
 * TDSI-59: envia la nota de credito (PDF adjunto) al correo indicado. Devuelve { estado: "ENVIADO" | "SIMULADO" | "ERROR", error? }.
 * Nunca lanza: el que llama decide que hacer con el resultado (y deja constancia en envios_comprobante).
 */
async function enviarNotaPorCorreo({ email, nota, devolucion, empresa, pdf }) {
  const transportador = transportadorConfigurado();
  if (!transportador) {
    console.log(`[email simulado] Nota de crédito ${nota.numero} para ${email}`);
    return { estado: "SIMULADO" };
  }
  try {
    await transportador.sendMail({
      from: process.env.SMTP_FROM || `"${empresa.nombre}" <no-responder@vortrix.local>`,
      to: email,
      subject: `Nota de crédito ${nota.numero}`,
      html: htmlNota({ nota, devolucion, empresa }),
      attachments: [{ filename: `nota-credito-${nota.numero}.pdf`, content: pdf, contentType: "application/pdf" }],
    });
    return { estado: "ENVIADO" };
  } catch (e) {
    console.error("Error enviando la nota de crédito por correo:", e.message);
    return { estado: "ERROR", error: e.message };
  }
}

module.exports = { enviarNotaPorCorreo, usarTransportadorDePrueba };
