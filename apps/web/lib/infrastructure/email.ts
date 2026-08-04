/**
 * Email infra: dos proveedores soportados, prioridad SMTP > Resend > fallback.
 *
 *   1. SMTP (nodemailer): si smtp_enabled = true en system_settings.
 *      Usable con Gmail (smtp.gmail.com:587 + app password), Zoho
 *      (smtppro.zoho.com:587), Outlook (smtp.office365.com:587), o cualquier
 *      relay corporativo. Es la opcion preferida cuando el operador ya tiene
 *      una casilla funcional y no quiere depender de un proveedor extra.
 *
 *   2. Resend (HTTP API): si email_resend_enabled = true. Requiere dominio
 *      verificado en https://resend.com pero no exige mantener un servidor
 *      SMTP propio. Mantenemos compatibilidad porque ya hay deployments que
 *      lo configuraron.
 *
 *   3. Fallback: si ningun proveedor esta configurado retorna { sent: false,
 *      reason: 'no_email_provider' } y el caller muestra un link copiable
 *      manual al admin (UX de invitaciones funciona sin email desde dia 1).
 *
 * Las contraseñas / api keys se guardan encriptadas en app.system_settings
 * (AES-256-GCM, ver V121). NUNCA exponer al frontend.
 */

import nodemailer, { type Transporter } from "nodemailer";

const RESEND_BASE = "https://api.resend.com";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
};

export type SendEmailResult = {
  sent: boolean;
  reason?: string;
  messageId?: string;
  provider?: "smtp" | "resend";
};

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

type ResendConfig = {
  apiKey: string;
  from: string | null;
};

/**
 * Cache de transporter SMTP — crear un transporter por cada email es lento
 * (handshake TLS por mensaje). Re-creamos solo cuando cambian las settings.
 */
let cachedTransporter: { config: SmtpConfig; transport: Transporter } | null = null;

function smtpConfigEqual(a: SmtpConfig, b: SmtpConfig): boolean {
  return (
    a.host === b.host &&
    a.port === b.port &&
    a.secure === b.secure &&
    a.user === b.user &&
    a.password === b.password
  );
}

function getTransporter(cfg: SmtpConfig): Transporter {
  if (cachedTransporter && smtpConfigEqual(cachedTransporter.config, cfg)) {
    return cachedTransporter.transport;
  }
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure, // true=465 SSL, false=STARTTLS (puerto 587)
    auth: { user: cfg.user, pass: cfg.password },
  });
  cachedTransporter = { config: cfg, transport };
  return transport;
}

async function loadSmtpConfig(): Promise<SmtpConfig | null> {
  try {
    const { getSystemSettingValue } = await import("@/lib/domains/system-settings");
    const enabled = await getSystemSettingValue("smtp_enabled");
    if (enabled !== "true") return null;
    const host = (await getSystemSettingValue("smtp_host"))?.trim();
    const portStr = (await getSystemSettingValue("smtp_port"))?.trim();
    const secureStr = (await getSystemSettingValue("smtp_secure"))?.trim();
    const user = (await getSystemSettingValue("smtp_user"))?.trim();
    const password = (await getSystemSettingValue("smtp_password"))?.trim();
    const from = (await getSystemSettingValue("smtp_from"))?.trim();
    if (!host || !user || !password) return null;
    const port = Number(portStr || "587");
    return {
      host,
      port: Number.isFinite(port) ? port : 587,
      secure: secureStr === "true" || port === 465,
      user,
      password,
      from: from || user,
    };
  } catch {
    return null;
  }
}

async function loadResendConfig(): Promise<ResendConfig | null> {
  let apiKey: string | null = null;
  let from: string | null = null;
  try {
    const { getSystemSettingValue } = await import("@/lib/domains/system-settings");
    const enabled = await getSystemSettingValue("email_resend_enabled");
    if (enabled === "true") {
      apiKey = await getSystemSettingValue("email_resend_api_key");
      from = await getSystemSettingValue("email_resend_from");
    }
  } catch {
    // Tabla no creada (migracion pendiente) — fallback a env
  }
  if (!apiKey) apiKey = process.env.RESEND_API_KEY ?? null;
  if (!from) from = process.env.RESEND_FROM_EMAIL ?? null;
  if (!apiKey || !apiKey.trim()) return null;
  return { apiKey: apiKey.trim(), from: from?.trim() || null };
}

async function sendViaSmtp(
  input: SendEmailInput,
  cfg: SmtpConfig,
): Promise<SendEmailResult> {
  try {
    const transport = getTransporter(cfg);
    const info = await transport.sendMail({
      from: input.from || cfg.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { sent: true, provider: "smtp", messageId: info.messageId };
  } catch (e) {
    // Si el handshake fallo invalidamos el cache — credenciales pudieron
    // haber cambiado entre intentos.
    cachedTransporter = null;
    const msg = e instanceof Error ? e.message : String(e);
    return { sent: false, provider: "smtp", reason: `smtp: ${msg}` };
  }
}

async function sendViaResend(
  input: SendEmailInput,
  cfg: ResendConfig,
): Promise<SendEmailResult> {
  const from =
    input.from || cfg.from || "Aibenchef <no-reply@aibenchef.dev>";
  try {
    const resp = await fetch(`${RESEND_BASE}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return {
        sent: false,
        provider: "resend",
        reason: `resend_${resp.status}: ${errText.slice(0, 200)}`,
      };
    }
    const json = (await resp.json()) as { id?: string };
    return { sent: true, provider: "resend", messageId: json.id };
  } catch (e) {
    return {
      sent: false,
      provider: "resend",
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // SMTP tiene prioridad — es el path mas comun para self-hosted (Gmail/Zoho).
  const smtp = await loadSmtpConfig();
  if (smtp) {
    return sendViaSmtp(input, smtp);
  }
  const resend = await loadResendConfig();
  if (resend) {
    return sendViaResend(input, resend);
  }
  return { sent: false, reason: "no_email_provider" };
}

/**
 * Para que el boton "Probar" desde Settings pueda ejercitar la config actual
 * sin enviar a un usuario real. Devuelve diagnostico utilizable.
 */
export async function testEmailConfig(toAddress: string): Promise<SendEmailResult> {
  return sendEmail({
    to: toAddress,
    subject: "Aibenchef — prueba de configuracion de email",
    text:
      "Este es un email de prueba enviado desde Aibenchef.\n\nSi llego es porque la configuracion SMTP / Resend esta funcionando.",
    html:
      "<p>Este es un email de <strong>prueba</strong> enviado desde Aibenchef.</p>" +
      "<p>Si llego es porque la configuracion SMTP / Resend esta funcionando.</p>",
  });
}

/**
 * Plantilla para reset de contrasena self-service. Se usa cuando el user
 * pide 'olvide mi contrasena' desde /forgot-password.
 */
export function renderPasswordResetEmail(args: {
  appName: string;
  userName: string;
  resetUrl: string;
  expiresAt: Date;
}): { subject: string; html: string; text: string } {
  const fmtTime = args.expiresAt.toLocaleString("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const subject = `Restablece tu contrasena de ${args.appName}`;
  const text = `Hola ${args.userName},\n\nRecibiste este email porque solicitaste restablecer tu contrasena de ${args.appName}.\n\nHaz click en el siguiente link para elegir una nueva (expira ${fmtTime}):\n${args.resetUrl}\n\nSi no fuiste tu, puedes ignorar este email — nadie sabra que llego.\n`;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="padding:24px 28px;border-bottom:1px solid #e2e8f0">
      <div style="display:inline-block;width:32px;height:32px;background:linear-gradient(135deg,#2563eb,#1d4ed8);border-radius:8px;color:#fff;font-weight:700;text-align:center;line-height:32px;font-size:14px;margin-right:8px;vertical-align:middle">A</div>
      <span style="font-weight:700;font-size:16px;vertical-align:middle">${args.appName}</span>
    </div>
    <div style="padding:32px 28px">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700">Restablece tu contrasena</h1>
      <p style="margin:0 0 16px;color:#475569;line-height:1.5">
        Hola <strong>${args.userName}</strong>, recibimos una solicitud para restablecer tu contrasena.
      </p>
      <p style="margin:0 0 24px;color:#475569;line-height:1.5">
        Clickea el boton para elegir una nueva. El link expira el <strong>${fmtTime}</strong>.
      </p>
      <a href="${args.resetUrl}"
         style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
        Restablecer contrasena
      </a>
      <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;line-height:1.5">
        Si no fuiste tu, puedes ignorar este email — tu cuenta sigue como esta. Nadie sabra que llego.
      </p>
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">
      Si el boton no funciona, copia este link:<br>
      <a href="${args.resetUrl}" style="color:#2563eb;word-break:break-all">${args.resetUrl}</a>
    </div>
  </div>
</body>
</html>`;
  return { subject, html, text };
}

/**
 * Plantilla HTML minima — sin librerias, inline styles compatibles con email.
 */
export function renderInvitationEmail(args: {
  appName: string;
  inviterName: string;
  inviteUrl: string;
  role: string;
  expiresAt: Date;
}): { subject: string; html: string; text: string } {
  const fmtDate = args.expiresAt.toLocaleDateString("es-PE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const subject = `Te invitaron a ${args.appName}`;
  const text = `Hola,\n\n${args.inviterName} te invito a unirte a ${args.appName} como ${args.role}.\n\nAceptar invitacion (expira ${fmtDate}):\n${args.inviteUrl}\n\nSi no esperabas este email, puedes ignorarlo.\n`;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="padding:24px 28px;border-bottom:1px solid #e2e8f0">
      <div style="display:inline-block;width:32px;height:32px;background:linear-gradient(135deg,#2563eb,#1d4ed8);border-radius:8px;color:#fff;font-weight:700;text-align:center;line-height:32px;font-size:14px;margin-right:8px;vertical-align:middle">A</div>
      <span style="font-weight:700;font-size:16px;vertical-align:middle">${args.appName}</span>
    </div>
    <div style="padding:32px 28px">
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:700">Te invitaron</h1>
      <p style="margin:0 0 16px;color:#475569;line-height:1.5">
        <strong>${args.inviterName}</strong> te invito a unirte a ${args.appName} como
        <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:13px">${args.role}</code>.
      </p>
      <p style="margin:0 0 24px;color:#475569;line-height:1.5">
        Clickea el boton para crear tu cuenta. El link expira el <strong>${fmtDate}</strong>.
      </p>
      <a href="${args.inviteUrl}"
         style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
        Aceptar invitacion
      </a>
      <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;line-height:1.5">
        Si no esperabas este email, puedes ignorarlo. Nadie sabra que llego.
      </p>
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">
      Si el boton no funciona, copia este link:<br>
      <a href="${args.inviteUrl}" style="color:#2563eb;word-break:break-all">${args.inviteUrl}</a>
    </div>
  </div>
</body>
</html>`;
  return { subject, html, text };
}
