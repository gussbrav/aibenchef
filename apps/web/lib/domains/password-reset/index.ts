/**
 * Domain: password reset admin-driven.
 *
 * Flujo:
 *   1. Admin clickea "Copiar URL de restablecimiento" sobre un usuario.
 *      -> createResetTokenForUser(actorId, targetId) genera un token random
 *         (32 bytes hex) y devuelve la URL completa /reset-password?token=...
 *   2. Admin entrega el link al usuario por el canal que prefiera.
 *   3. Usuario abre el link, ve un form simple "nueva contraseña".
 *   4. POST /api/v1/auth/admin-reset-password { token, newPassword }:
 *      -> consumeResetToken: valida vigencia + not used, hashea la password
 *         con Better Auth's hashPassword (mismo formato que el signup) y
 *         actualiza auth.accounts.password. Marca el token como used_at.
 *
 * Decision: NO usamos Better Auth's forgot-password flow porque requiere
 * email verification activo + un mecanismo de email confiable. El admin
 * tiene control directo y el link viaja por el canal que el operador elija.
 */

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

import { db } from "@/lib/infrastructure/db";
import {
  NotFoundError,
  toIso,
  ValidationError,
} from "@/lib/domains/shared";
import { getUser, requireAdmin } from "@/lib/domains/users";
import { renderPasswordResetEmail, sendEmail } from "@/lib/infrastructure/email";

export type ResetTokenInfo = {
  token: string;
  url: string;
  expiresAt: string;
  userId: string;
  userEmail: string;
};

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

function genToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Admin emite un nuevo token de reset para un usuario. Revoca tokens
 * previos no usados del mismo user para evitar links viejos al aire.
 */
export async function createResetTokenForUser(
  actorId: string,
  targetUserId: string,
): Promise<ResetTokenInfo> {
  await requireAdmin(actorId);
  if (actorId === targetUserId) {
    throw new ValidationError(
      "Para resetear tu propia contraseña usa la opcion 'Cambiar contraseña' en tu perfil",
      {},
    );
  }
  const user = await getUser(targetUserId);

  // Invalidar tokens previos pendientes del mismo usuario
  await db.execute(sql`
    UPDATE app.password_reset_tokens
    SET used_at = now()
    WHERE user_id = ${targetUserId}
      AND used_at IS NULL
      AND expires_at > now()
  `);

  const token = genToken();
  const rows = await db.execute<{ expires_at: Date }>(sql`
    INSERT INTO app.password_reset_tokens (token, user_id, issued_by)
    VALUES (${token}, ${targetUserId}, ${actorId})
    RETURNING expires_at
  `);
  return {
    token,
    url: `${appUrl()}/reset-password?token=${token}`,
    expiresAt: toIso(rows[0]?.expires_at),
    userId: targetUserId,
    userEmail: user.email,
  };
}

/**
 * Self-service (publico): el usuario dice "olvide mi contrasena", ingresa
 * su email en /forgot-password, y esta funcion:
 *   1. Busca el user por email.
 *   2. Si existe -> genera token + manda email con el link /reset-password?token=X.
 *   3. Si NO existe -> hace NADA (silencioso) pero retorna igual.
 *
 * IMPORTANTE: siempre devuelve el mismo shape sin importar si el email
 * existe o no. Anti-enumeration: un atacante no puede usar este endpoint
 * para saber que emails estan registrados en la plataforma.
 *
 * Rate limit basico: si ya hay un token activo de <60s para ese user,
 * NO se genera otro. Evita spam de emails por click repetido.
 */
export async function requestPasswordResetSelfService(
  email: string,
): Promise<{ emailSent: boolean; reason?: string }> {
  const emailNorm = email.trim().toLowerCase();
  if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    // Sin throw — anti-enumeration. Retornamos como si nada.
    return { emailSent: false, reason: "invalid_email" };
  }

  const users = await db.execute<{ id: string; email: string; name: string | null }>(sql`
    SELECT id, email, name
    FROM auth.users
    WHERE lower(email) = ${emailNorm}
    LIMIT 1
  `);
  if (users.length === 0) {
    // Email no registrado — devolvemos ok para no leakear. El usuario
    // que realmente olvido su pass no notara nada (no le llega mail)
    // pero tampoco lo notaria un atacante.
    return { emailSent: false, reason: "no_user" };
  }
  const user = users[0]!;

  // Anti-spam: si hay token activo emitido en los ultimos 60s, no
  // generamos otro. Evita que un click doble mande 2 mails.
  const recientes = await db.execute<{ id: string }>(sql`
    SELECT id FROM app.password_reset_tokens
    WHERE user_id = ${user.id}
      AND used_at IS NULL
      AND expires_at > now()
      AND created_at > now() - interval '60 seconds'
    LIMIT 1
  `);
  if (recientes.length > 0) {
    // Silencioso: pretendemos que se envio para no revelar el rate limit.
    return { emailSent: false, reason: "rate_limited" };
  }

  // Invalidar tokens previos activos (mismo criterio que admin-driven).
  await db.execute(sql`
    UPDATE app.password_reset_tokens
    SET used_at = now()
    WHERE user_id = ${user.id}
      AND used_at IS NULL
      AND expires_at > now()
  `);

  const token = genToken();
  const inserted = await db.execute<{ expires_at: Date }>(sql`
    INSERT INTO app.password_reset_tokens (token, user_id, issued_by)
    VALUES (${token}, ${user.id}, NULL)
    RETURNING expires_at
  `);
  const url = `${appUrl()}/reset-password?token=${token}`;

  // Enviar email (best-effort — si SMTP no esta configurado, retorna
  // { emailSent: false, reason: 'no_email_provider' }).
  const tpl = renderPasswordResetEmail({
    appName: "Aibenchef",
    userName: user.name?.trim() || user.email.split("@")[0]!,
    resetUrl: url,
    expiresAt: new Date(inserted[0]?.expires_at ?? Date.now() + 3600 * 1000),
  });
  const result = await sendEmail({
    to: user.email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  });
  return { emailSent: result.sent, reason: result.reason };
}

/**
 * Lookup publico (sin auth): valida que el token este activo y devuelve
 * el email asociado para mostrar en el form ("vas a resetear pass de X").
 */
export async function previewResetToken(token: string): Promise<{
  email: string;
  expiresAt: string;
} | null> {
  if (!token || token.length < 32) return null;
  const rows = await db.execute<{ email: string; expires_at: Date }>(sql`
    SELECT u.email, t.expires_at
    FROM app.password_reset_tokens t
    JOIN auth.users u ON u.id = t.user_id
    WHERE t.token = ${token}
      AND t.used_at IS NULL
      AND t.expires_at > now()
    LIMIT 1
  `);
  if (rows.length === 0) return null;
  return { email: rows[0]!.email, expiresAt: toIso(rows[0]!.expires_at) };
}

/**
 * Consume un token: hashea la nueva password con el mismo algoritmo que
 * Better Auth (asi un login posterior con esa contraseña pasa el verifyPassword)
 * y actualiza auth.accounts.password. Marca el token usado.
 *
 * Si la cuenta credentials no existe (ej. user solo OAuth) la crea.
 */
export async function consumeResetToken(
  token: string,
  newPassword: string,
): Promise<{ userId: string }> {
  if (!token || token.length < 32) {
    throw new ValidationError("Token invalido", {});
  }
  if (!newPassword || newPassword.length < 8) {
    throw new ValidationError("La contraseña debe tener al menos 8 caracteres", {});
  }
  if (newPassword.length > 256) {
    throw new ValidationError("Contraseña demasiado larga", {});
  }
  const rows = await db.execute<{ id: string; user_id: string }>(sql`
    SELECT id, user_id
    FROM app.password_reset_tokens
    WHERE token = ${token}
      AND used_at IS NULL
      AND expires_at > now()
    LIMIT 1
  `);
  if (rows.length === 0) {
    throw new NotFoundError("Token invalido, ya usado o expirado", {});
  }
  const { id, user_id } = rows[0]!;

  const hash = await hashPassword(newPassword);

  // Better Auth usa providerId='credential' para email+password. Si ya existe
  // ese account, lo actualizamos; sino creamos uno nuevo.
  const userRows = await db.execute<{ email: string }>(
    sql`SELECT email FROM auth.users WHERE id = ${user_id} LIMIT 1`,
  );
  if (userRows.length === 0) {
    throw new NotFoundError("Usuario no encontrado", {});
  }
  const email = userRows[0]!.email;

  const accountRows = await db.execute<{ id: string }>(sql`
    SELECT id FROM auth.accounts
    WHERE user_id = ${user_id} AND provider_id = 'credential'
    LIMIT 1
  `);

  if (accountRows.length > 0) {
    await db.execute(sql`
      UPDATE auth.accounts
      SET password = ${hash}, updated_at = now()
      WHERE id = ${accountRows[0]!.id}
    `);
  } else {
    await db.execute(sql`
      INSERT INTO auth.accounts (user_id, provider_id, account_id, password)
      VALUES (${user_id}, 'credential', ${email}, ${hash})
    `);
  }

  // Mark token used + opcional: invalidar sesiones existentes para forzar
  // re-login con la nueva password (mejor postura de seguridad).
  await db.execute(sql`
    UPDATE app.password_reset_tokens SET used_at = now() WHERE id = ${id}
  `);
  await db.execute(sql`DELETE FROM auth.sessions WHERE user_id = ${user_id}`);

  try {
    await db.execute(sql`
      INSERT INTO auth.users_audit (user_id, accion, detalle, actor_id)
      VALUES (${user_id}, 'password_reset', 'via admin token', NULL)
    `);
  } catch {
    /* swallow */
  }
  return { userId: user_id };
}
