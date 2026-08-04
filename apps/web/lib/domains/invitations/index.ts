/**
 * Domain: invitaciones a usuarios nuevos.
 *
 * Flujo:
 *   1. createInvitation(actorId, email, role) por admin
 *      -> genera token random + URL absoluta /signup?token=...
 *   2. previewInvitation(token) — publico, devuelve { email, role, expiresAt }
 *      (sin auth, para que el frontend de signup valide y pre-llene email)
 *   3. acceptInvitation(token, userId) — tras signup exitoso de Better Auth,
 *      el frontend llama este endpoint con la session activa; el server
 *      verifica que el email del user matches con el de la invitacion,
 *      asigna el rol, y marca la invitacion como aceptada.
 */

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import {
  ConflictError,
  NotFoundError,
  toIso,
  ValidationError,
} from "@/lib/domains/shared";
import { renderInvitationEmail, sendEmail } from "@/lib/infrastructure/email";
import { requireAdmin } from "@/lib/domains/users";

export type InvitationRole = "admin" | "usuario";

export type Invitation = {
  id: string;
  token: string;
  email: string;
  role: InvitationRole;
  invitedBy: string;
  invitedByName?: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  revokedAt: string | null;
  archivedAt: string | null;
  notas: string | null;
  createdAt: string;
  url: string; // construida al vuelo
};

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

function mapRow(r: Record<string, unknown>): Invitation {
  const token = String(r.token);
  return {
    id: String(r.id),
    token,
    email: String(r.email),
    role: r.role as InvitationRole,
    invitedBy: String(r.invited_by),
    invitedByName: (r.invited_by_name as string | null) ?? null,
    expiresAt: toIso(r.expires_at),
    acceptedAt: r.accepted_at ? toIso(r.accepted_at) : null,
    acceptedBy: (r.accepted_by as string | null) ?? null,
    revokedAt: r.revoked_at ? toIso(r.revoked_at) : null,
    archivedAt: r.archived_at ? toIso(r.archived_at) : null,
    notas: (r.notas as string | null) ?? null,
    createdAt: toIso(r.created_at),
    url: `${appUrl()}/signup?token=${token}`,
  };
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function listInvitations(opts?: {
  includeArchived?: boolean;
}): Promise<Invitation[]> {
  const includeArchived = opts?.includeArchived ?? false;
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT i.id, i.token, i.email, i.role, i.invited_by,
             u.name AS invited_by_name,
             i.expires_at, i.accepted_at, i.accepted_by,
             i.revoked_at, i.archived_at, i.notas, i.created_at
      FROM app.invitations i
      LEFT JOIN auth.users u ON u.id = i.invited_by
      WHERE ${includeArchived ? sql`TRUE` : sql`i.archived_at IS NULL`}
      ORDER BY i.created_at DESC
      LIMIT 200
    `,
  );
  return rows.map(mapRow);
}

/**
 * Archiva una invitacion — la oculta del listado default pero la preserva
 * en la tabla para auditoria. Solo aplica a invitaciones ya cerradas
 * (aceptadas, revocadas o expiradas). Las PENDIENTES no se pueden
 * archivar — hay que revocarlas primero.
 */
export async function archiveInvitation(actorId: string, id: string): Promise<void> {
  await requireAdmin(actorId);
  const rows = await db.execute<{ id: string }>(
    sql`
      UPDATE app.invitations
      SET archived_at = now()
      WHERE id = ${id}
        AND archived_at IS NULL
        AND (
          accepted_at IS NOT NULL
          OR revoked_at IS NOT NULL
          OR expires_at <= now()
        )
      RETURNING id
    `,
  );
  if (rows.length === 0) {
    throw new NotFoundError(
      "Invitacion no encontrada, aun esta pendiente o ya archivada",
      {},
    );
  }
}

export async function unarchiveInvitation(actorId: string, id: string): Promise<void> {
  await requireAdmin(actorId);
  const rows = await db.execute<{ id: string }>(
    sql`
      UPDATE app.invitations
      SET archived_at = NULL
      WHERE id = ${id} AND archived_at IS NOT NULL
      RETURNING id
    `,
  );
  if (rows.length === 0) {
    throw new NotFoundError("Invitacion no encontrada o no archivada", {});
  }
}

export async function createInvitation(
  actorId: string,
  data: { email: string; role: InvitationRole; notas?: string | null },
): Promise<{ invitation: Invitation; emailSent: boolean; emailReason?: string }> {
  await requireAdmin(actorId);
  const email = data.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("Email invalido", {});
  }

  // Si ya existe un usuario activo con ese email, no permitir
  const existing = await db.execute<{ id: string }>(
    sql`SELECT id FROM auth.users WHERE lower(email) = ${email} LIMIT 1`,
  );
  if (existing.length > 0) {
    throw new ConflictError(`Ya existe un usuario con el email ${email}`, {});
  }

  // Si ya hay invitacion pendiente no expirada, revocarla antes
  await db.execute(
    sql`
      UPDATE app.invitations
      SET revoked_at = now()
      WHERE email = ${email}
        AND accepted_at IS NULL
        AND revoked_at IS NULL
    `,
  );

  const token = generateToken();
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      INSERT INTO app.invitations (token, email, role, invited_by, notas)
      VALUES (${token}, ${email}, ${data.role}, ${actorId}, ${data.notas ?? null})
      RETURNING id, token, email, role, invited_by, expires_at, accepted_at,
                accepted_by, revoked_at, notas, created_at
    `,
  );
  const invitation = mapRow(rows[0]!);

  // Intentar enviar email (best-effort)
  let emailSent = false;
  let emailReason: string | undefined;
  try {
    // Obtener el nombre del inviter
    const inviterRows = await db.execute<{ name: string }>(
      sql`SELECT name FROM auth.users WHERE id = ${actorId}`,
    );
    const inviterName = inviterRows[0]?.name || "Un administrador";
    const tpl = renderInvitationEmail({
      appName: "Aibenchef",
      inviterName,
      inviteUrl: invitation.url,
      role: data.role,
      expiresAt: new Date(invitation.expiresAt),
    });
    const result = await sendEmail({
      to: email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
    emailSent = result.sent;
    emailReason = result.reason;
  } catch (e) {
    emailReason = e instanceof Error ? e.message : String(e);
  }

  return { invitation, emailSent, emailReason };
}

/**
 * Re-enviar el email de una invitacion pendiente. NO regenera el token
 * (asi el link que se envio antes sigue siendo valido). Solo dispara
 * sendEmail otra vez con la misma plantilla.
 */
export async function resendInvitationEmail(
  actorId: string,
  id: string,
): Promise<{ emailSent: boolean; emailReason?: string }> {
  await requireAdmin(actorId);
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT id, token, email, role, invited_by, expires_at, accepted_at,
             accepted_by, revoked_at, notas, created_at
      FROM app.invitations
      WHERE id = ${id}
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > now()
      LIMIT 1
    `,
  );
  if (rows.length === 0) {
    throw new NotFoundError(
      "Invitacion no encontrada, ya aceptada, revocada o expirada",
      {},
    );
  }
  const invitation = mapRow(rows[0]!);
  const inviterRows = await db.execute<{ name: string }>(
    sql`SELECT name FROM auth.users WHERE id = ${actorId}`,
  );
  const inviterName = inviterRows[0]?.name || "Un administrador";
  const tpl = renderInvitationEmail({
    appName: "Aibenchef",
    inviterName,
    inviteUrl: invitation.url,
    role: invitation.role,
    expiresAt: new Date(invitation.expiresAt),
  });
  const result = await sendEmail({
    to: invitation.email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  });
  return { emailSent: result.sent, emailReason: result.reason };
}

/**
 * Devuelve la invitacion pendiente para el email del usuario, o null si
 * nunca se invito o ya se acepto. Util para el menu admin: si existe,
 * mostramos "Reenviar invitacion"; sino, ocultamos la accion.
 */
export async function findPendingInvitationByEmail(
  email: string,
): Promise<Invitation | null> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT id, token, email, role, invited_by, expires_at, accepted_at,
             accepted_by, revoked_at, notas, created_at
      FROM app.invitations
      WHERE lower(email) = ${email.toLowerCase()}
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1
    `,
  );
  return rows.length > 0 ? mapRow(rows[0]!) : null;
}

export async function revokeInvitation(actorId: string, id: string): Promise<void> {
  await requireAdmin(actorId);
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      UPDATE app.invitations
      SET revoked_at = now()
      WHERE id = ${id} AND revoked_at IS NULL AND accepted_at IS NULL
      RETURNING id
    `,
  );
  if (rows.length === 0) {
    throw new NotFoundError(
      "Invitacion no encontrada o ya consumida/revocada",
      {},
    );
  }
}

/**
 * Publico (sin auth): devuelve email + role + expiracion para pre-llenar el form.
 * No expone el token en la response.
 */
export async function previewInvitation(token: string): Promise<{
  email: string;
  role: InvitationRole;
  expiresAt: string;
} | null> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT email, role, expires_at
      FROM app.invitations
      WHERE token = ${token}
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > now()
      LIMIT 1
    `,
  );
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    email: String(r.email),
    role: r.role as InvitationRole,
    expiresAt: toIso(r.expires_at),
  };
}

/**
 * Consume la invitacion. Requiere que el usuario autenticado tenga email
 * que matchea la invitacion (anti-foot-shoot: un usuario no puede aceptar
 * la invitacion de otro).
 */
export async function acceptInvitation(
  token: string,
  userId: string,
): Promise<{ role: InvitationRole }> {
  // Validar token + obtener data
  const invRows = await db.execute<{
    id: string;
    email: string;
    role: InvitationRole;
  }>(
    sql`
      SELECT id, email, role
      FROM app.invitations
      WHERE token = ${token}
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > now()
      LIMIT 1
    `,
  );
  if (invRows.length === 0) {
    throw new ValidationError(
      "Invitacion invalida, expirada o ya consumida",
      {},
    );
  }
  const inv = invRows[0]!;

  // Validar que el usuario autenticado matchea el email de la invitacion
  const userRows = await db.execute<{ email: string }>(
    sql`SELECT email FROM auth.users WHERE id = ${userId} LIMIT 1`,
  );
  if (userRows.length === 0) {
    throw new ValidationError("Usuario no encontrado", {});
  }
  if (userRows[0]!.email.toLowerCase() !== inv.email.toLowerCase()) {
    throw new ValidationError(
      "El email de tu cuenta no coincide con la invitacion",
      {},
    );
  }

  // Actualizar role del usuario + marcar invitacion aceptada (en una transaccion)
  await db.execute(
    sql`
      UPDATE auth.users
      SET role = ${inv.role}, updated_at = now(), invited_by = (
        SELECT invited_by FROM app.invitations WHERE id = ${inv.id}
      )
      WHERE id = ${userId}
    `,
  );
  await db.execute(
    sql`
      UPDATE app.invitations
      SET accepted_at = now(), accepted_by = ${userId}
      WHERE id = ${inv.id}
    `,
  );

  return { role: inv.role };
}
