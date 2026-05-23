/**
 * Email infra mínima.
 *
 * Si esta seteado RESEND_API_KEY -> envia via Resend.
 * Si no -> devuelve { sent: false } y el caller debe mostrar el link manual.
 *
 * Estrategia de fallback: en lugar de fallar si no hay email configurado,
 * permitimos al admin copiar el link de invitacion y compartirlo manualmente
 * (WhatsApp, Slack, etc). Asi el sistema funciona desde dia 1 sin Resend.
 */

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
  reason?: string; // ej 'no_resend_key', 'rate_limited', etc
  messageId?: string;
};

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // Prioridad de configuracion:
  //   1. app.system_settings (UI, sin redeploy) — si email_resend_enabled=true
  //   2. process.env.RESEND_API_KEY (fallback legacy)
  let apiKey: string | null = null;
  let fromConfig: string | null = null;
  try {
    // Import dinamico para evitar ciclo de dependencias y permitir que esta
    // funcion funcione tambien en contextos donde no hay DB (tests, etc).
    const { getSystemSettingValue } = await import("@/lib/domains/system-settings");
    const enabled = await getSystemSettingValue("email_resend_enabled");
    if (enabled === "true") {
      apiKey = await getSystemSettingValue("email_resend_api_key");
      fromConfig = await getSystemSettingValue("email_resend_from");
    }
  } catch {
    // Si la tabla no existe aun (migracion pendiente) o falla la DB,
    // caemos al fallback de env vars.
  }
  if (!apiKey) {
    apiKey = process.env.RESEND_API_KEY ?? null;
  }
  if (!apiKey || !apiKey.trim()) {
    return { sent: false, reason: "no_resend_key" };
  }
  const from = input.from || fromConfig || process.env.RESEND_FROM_EMAIL || "Aibenchef <no-reply@aibenchef.dev>";

  try {
    const resp = await fetch(`${RESEND_BASE}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
      return { sent: false, reason: `resend_${resp.status}: ${errText.slice(0, 200)}` };
    }
    const json = (await resp.json()) as { id?: string };
    return { sent: true, messageId: json.id };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
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
  const text = `Hola,\n\n${args.inviterName} te invito a unirte a ${args.appName} como ${args.role}.\n\nAceptar invitacion (expira ${fmtDate}):\n${args.inviteUrl}\n\nSi no esperabas este email, podes ignorarlo.\n`;
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
        Si no esperabas este email, podes ignorarlo. Nadie sabra que llego.
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
