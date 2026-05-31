/**
 * Domain: access_requests — waitlist publica.
 *
 * Flujo:
 *   1. POST /api/v1/auth/request-access (publico)
 *      -> createAccessRequest({email, nombre, empresa, ...})
 *      -> chequea rate limit por ip_hash
 *      -> upsert en app.access_requests (UNIQUE email)
 *      -> dispara email al admin (best-effort)
 *      -> si el dominio del email esta en allowlist, auto-approve
 *
 *   2. Admin lista en /dashboard/admin/access-requests
 *      -> listAccessRequests(filtros) — solo admin
 *
 *   3. Admin clickea "Aprobar"
 *      -> approveAccessRequest(actorId, requestId, role)
 *      -> crea invitation via createInvitation()
 *      -> setea status='approved', invitation_id, approved_by, approved_at
 *      -> dispara email al solicitante con el link de signup
 *
 *   4. Admin clickea "Rechazar"
 *      -> rejectAccessRequest(actorId, requestId, reason?)
 *      -> setea status='rejected', rejection_reason, rejected_by, rejected_at
 *
 * Audit:
 *   - cada accion del admin se registra via recordAuditEvent (categoria 'admin')
 *   - create publico se registra como categoria 'auth' (sin actor)
 */

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import {
  ConflictError,
  NotFoundError,
  RateLimitError,
  toIso,
  ValidationError,
} from "@/lib/domains/shared";
import { renderInvitationEmail, sendEmail } from "@/lib/infrastructure/email";
import { requireAdmin } from "@/lib/domains/users";
import { createInvitation } from "@/lib/domains/invitations";

export type AccessRequestStatus = "pending" | "approved" | "rejected" | "spam";
export type TamanoEquipo = "solo" | "2-10" | "11-50" | "51-200" | "200+";

export type AccessRequest = {
  id: string;
  email: string;
  nombre: string;
  empresa: string;
  rol: string | null;
  tamanoEquipo: TamanoEquipo | null;
  casoUso: string | null;
  source: string;
  status: AccessRequestStatus;
  notasAdmin: string | null;
  rejectionReason: string | null;
  invitationId: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapRow(r: Record<string, unknown>): AccessRequest {
  return {
    id: String(r.id),
    email: String(r.email),
    nombre: String(r.nombre),
    empresa: String(r.empresa),
    rol: (r.rol as string | null) ?? null,
    tamanoEquipo: (r.tamano_equipo as TamanoEquipo | null) ?? null,
    casoUso: (r.caso_uso as string | null) ?? null,
    source: String(r.source ?? "signup_page"),
    status: (r.status as AccessRequestStatus) ?? "pending",
    notasAdmin: (r.notas_admin as string | null) ?? null,
    rejectionReason: (r.rejection_reason as string | null) ?? null,
    invitationId: (r.invitation_id as string | null) ?? null,
    approvedAt: r.approved_at ? toIso(r.approved_at) : null,
    approvedBy: (r.approved_by as string | null) ?? null,
    rejectedAt: r.rejected_at ? toIso(r.rejected_at) : null,
    rejectedBy: (r.rejected_by as string | null) ?? null,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

// =============================================================================
// Public create
// =============================================================================

const RATE_LIMIT_WINDOW_MIN = 60;
const RATE_LIMIT_MAX_PER_IP = 3;

export type CreateAccessRequestInput = {
  email: string;
  nombre: string;
  empresa: string;
  rol?: string | null;
  tamanoEquipo?: TamanoEquipo | null;
  casoUso?: string | null;
  source?: string;
  ipHash?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  /** Honeypot field — si trae valor es un bot, rechazar sin tocar DB. */
  honeypot?: string | null;
};

/**
 * Crea (o re-actualiza si ya existe esa email) una solicitud de acceso.
 * Aplica rate limit por ip_hash. Notifica admin por email. Si el dominio
 * esta en allowlist, hace auto-approve inmediatamente.
 *
 * Devuelve la AccessRequest creada. NO devuelve datos sensibles ni indica
 * si el email ya existia (privacy — un atacante no puede enumerar usuarios).
 */
export async function createAccessRequest(
  input: CreateAccessRequestInput,
): Promise<{ ok: true; autoApproved: boolean }> {
  if (input.honeypot && input.honeypot.trim() !== "") {
    // Bot. No tocamos DB ni reportamos error explicito — devolvemos OK silencioso.
    return { ok: true, autoApproved: false };
  }

  const email = input.email.trim().toLowerCase();
  const nombre = input.nombre.trim();
  const empresa = input.empresa.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("Email invalido", {});
  }
  if (nombre.length < 2 || nombre.length > 120) {
    throw new ValidationError("Nombre debe tener entre 2 y 120 caracteres", {});
  }
  if (empresa.length < 2 || empresa.length > 120) {
    throw new ValidationError("Empresa debe tener entre 2 y 120 caracteres", {});
  }

  // Rate limit por IP
  if (input.ipHash) {
    const window = `${RATE_LIMIT_WINDOW_MIN} minutes`;
    const rows = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n
      FROM app.access_request_rate
      WHERE ip_hash = ${input.ipHash}
        AND created_at > now() - interval '${sql.raw(window)}'
    `);
    if (Number(rows[0]?.n ?? 0) >= RATE_LIMIT_MAX_PER_IP) {
      throw new RateLimitError(
        `Demasiadas solicitudes desde tu IP. Intenta de nuevo en 1 hora.`,
        { window_min: RATE_LIMIT_WINDOW_MIN, max: RATE_LIMIT_MAX_PER_IP },
      );
    }
    await db.execute(sql`
      INSERT INTO app.access_request_rate (ip_hash) VALUES (${input.ipHash})
    `);
    // Limpieza opcional: borrar entries viejos (>24h)
    await db.execute(sql`
      DELETE FROM app.access_request_rate WHERE created_at < now() - interval '24 hours'
    `).catch(() => undefined);
  }

  // Rechazar si ya hay un usuario activo con ese email (no leak — privacy)
  const existingUser = await db.execute<{ id: string }>(
    sql`SELECT id FROM auth.users WHERE lower(email) = ${email} LIMIT 1`,
  );
  if (existingUser.length > 0) {
    // Devolvemos OK pero sin upsert (no queremos exponer que el email ya existe)
    return { ok: true, autoApproved: false };
  }

  // Upsert (un mismo lead puede mejorar su pitch reenviando)
  await db.execute(sql`
    INSERT INTO app.access_requests (
      email, nombre, empresa, rol, tamano_equipo, caso_uso,
      source, ip_hash, user_agent, referer
    ) VALUES (
      ${email}, ${nombre}, ${empresa},
      ${input.rol ?? null},
      ${input.tamanoEquipo ?? null},
      ${input.casoUso ?? null},
      ${input.source ?? "signup_page"},
      ${input.ipHash ?? null},
      ${input.userAgent?.slice(0, 500) ?? null},
      ${input.referer?.slice(0, 500) ?? null}
    )
    ON CONFLICT (email) DO UPDATE SET
      nombre = EXCLUDED.nombre,
      empresa = EXCLUDED.empresa,
      rol = COALESCE(EXCLUDED.rol, app.access_requests.rol),
      tamano_equipo = COALESCE(EXCLUDED.tamano_equipo, app.access_requests.tamano_equipo),
      caso_uso = COALESCE(EXCLUDED.caso_uso, app.access_requests.caso_uso),
      updated_at = now()
    WHERE app.access_requests.status = 'pending'
  `);

  // Auto-approve si el dominio esta en allowlist
  const domain = email.split("@")[1] ?? "";
  if (domain) {
    const allow = await db.execute<{ role: string }>(sql`
      SELECT role FROM app.access_auto_approve_domains WHERE domain = ${domain} LIMIT 1
    `);
    if (allow.length > 0) {
      const requestRows = await db.execute<{ id: string }>(sql`
        SELECT id FROM app.access_requests WHERE email = ${email} LIMIT 1
      `);
      if (requestRows.length > 0) {
        try {
          // Aprobacion automatica (actor = null, sistema)
          await internalAutoApprove(
            requestRows[0]!.id,
            (allow[0]!.role as "admin" | "usuario") ?? "usuario",
          );
          return { ok: true, autoApproved: true };
        } catch {
          // Si falla la auto-aprobacion, la dejamos pending para que el admin la procese manualmente.
        }
      }
    }
  }

  // Notificar admin (best-effort, no bloquear si falla)
  void notifyAdminOfNewRequest(email, empresa, nombre).catch(() => undefined);

  return { ok: true, autoApproved: false };
}

async function internalAutoApprove(
  requestId: string,
  role: "admin" | "usuario",
): Promise<void> {
  const requestRows = await db.execute<Record<string, unknown>>(sql`
    SELECT * FROM app.access_requests WHERE id = ${requestId} AND status = 'pending' LIMIT 1
  `);
  if (requestRows.length === 0) return;
  const req = mapRow(requestRows[0]!);

  // Crear invitation. NOTA: createInvitation requiere actorId admin; aca
  // no hay actor (sistema). Llamamos directamente al SQL para evitar el
  // requireAdmin check. La invitacion queda con invited_by = NULL.
  const { randomBytes } = await import("node:crypto");
  const token = randomBytes(32).toString("hex");
  const invRows = await db.execute<{ id: string }>(sql`
    INSERT INTO app.invitations (token, email, role, invited_by, notas)
    VALUES (${token}, ${req.email}, ${role}, NULL,
            ${`Auto-aprobado por dominio (access_request ${req.id})`})
    RETURNING id
  `);
  const invitationId = invRows[0]?.id;

  await db.execute(sql`
    UPDATE app.access_requests
    SET status = 'approved',
        invitation_id = ${invitationId ?? null},
        approved_at = now()
    WHERE id = ${requestId}
  `);

  // Email al solicitante con el link
  const appUrlBase = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  const inviteUrl = `${appUrlBase}/signup?token=${token}`;
  try {
    const tpl = renderInvitationEmail({
      appName: "Aibenchef",
      inviterName: "El equipo de Aibenchef",
      inviteUrl,
      role,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await sendEmail({
      to: req.email,
      subject: `✓ Tu solicitud de Aibenchef fue aprobada`,
      html: tpl.html,
      text: tpl.text,
    });
  } catch {
    /* swallow */
  }
}

async function notifyAdminOfNewRequest(
  email: string,
  empresa: string,
  nombre: string,
): Promise<void> {
  const adminRows = await db.execute<{ email: string }>(sql`
    SELECT email FROM auth.users WHERE role = 'admin' AND status = 'active' ORDER BY created_at ASC LIMIT 1
  `);
  const adminEmail = adminRows[0]?.email;
  if (!adminEmail) return;
  const appUrlBase = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  const panelUrl = `${appUrlBase}/dashboard/admin/access-requests`;
  await sendEmail({
    to: adminEmail,
    subject: `Nueva solicitud de acceso: ${empresa}`,
    text:
      `Llego una solicitud de acceso a Aibenchef:\n\n` +
      `Email: ${email}\n` +
      `Nombre: ${nombre}\n` +
      `Empresa: ${empresa}\n\n` +
      `Revisala y aprobala/rechazala desde:\n${panelUrl}\n`,
    html: `
<p>Llego una nueva solicitud de acceso a Aibenchef:</p>
<ul>
  <li><strong>Email:</strong> ${email}</li>
  <li><strong>Nombre:</strong> ${nombre}</li>
  <li><strong>Empresa:</strong> ${empresa}</li>
</ul>
<p><a href="${panelUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Abrir panel de solicitudes</a></p>
`,
  });
}

// =============================================================================
// Admin listing / actions
// =============================================================================

export type ListAccessRequestsFilter = {
  status?: AccessRequestStatus | "all";
  search?: string;
  limit?: number;
  offset?: number;
};

export async function listAccessRequests(
  actorId: string,
  filter: ListAccessRequestsFilter = {},
): Promise<{ rows: AccessRequest[]; total: number }> {
  await requireAdmin(actorId);
  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const status = filter.status ?? "pending";
  const search = filter.search?.trim().toLowerCase();

  const where = sql.empty();
  const parts: ReturnType<typeof sql>[] = [];
  if (status !== "all") {
    parts.push(sql`status = ${status}`);
  }
  if (search) {
    parts.push(
      sql`(lower(email) LIKE ${"%" + search + "%"} OR lower(empresa) LIKE ${"%" + search + "%"} OR lower(nombre) LIKE ${"%" + search + "%"})`,
    );
  }
  const whereSql = parts.length > 0
    ? sql`WHERE ${sql.join(parts, sql` AND `)}`
    : where;

  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT id, email, nombre, empresa, rol, tamano_equipo, caso_uso,
           source, status, notas_admin, rejection_reason,
           invitation_id, approved_at, approved_by, rejected_at, rejected_by,
           created_at, updated_at
    FROM app.access_requests
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  const totalRows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM app.access_requests ${whereSql}
  `);
  return {
    rows: rows.map(mapRow),
    total: Number(totalRows[0]?.n ?? 0),
  };
}

export async function getAccessRequest(
  actorId: string,
  id: string,
): Promise<AccessRequest> {
  await requireAdmin(actorId);
  const rows = await db.execute<Record<string, unknown>>(
    sql`SELECT * FROM app.access_requests WHERE id = ${id} LIMIT 1`,
  );
  if (rows.length === 0) {
    throw new NotFoundError("Solicitud no encontrada", {});
  }
  return mapRow(rows[0]!);
}

export async function approveAccessRequest(
  actorId: string,
  requestId: string,
  data: { role: "admin" | "usuario"; notas?: string | null },
): Promise<{ accessRequest: AccessRequest; emailSent: boolean }> {
  await requireAdmin(actorId);
  const req = await getAccessRequest(actorId, requestId);
  if (req.status !== "pending") {
    throw new ConflictError(
      `La solicitud ya esta en status ${req.status}, no se puede aprobar`,
      {},
    );
  }
  const { invitation, emailSent } = await createInvitation(actorId, {
    email: req.email,
    role: data.role,
    notas: data.notas ?? `Aprobado desde access_request ${requestId}`,
  });
  await db.execute(sql`
    UPDATE app.access_requests
    SET status = 'approved',
        invitation_id = ${invitation.id},
        approved_at = now(),
        approved_by = ${actorId},
        notas_admin = COALESCE(${data.notas ?? null}, notas_admin)
    WHERE id = ${requestId}
  `);
  return {
    accessRequest: await getAccessRequest(actorId, requestId),
    emailSent,
  };
}

export async function rejectAccessRequest(
  actorId: string,
  requestId: string,
  reason: string | null,
): Promise<AccessRequest> {
  await requireAdmin(actorId);
  const req = await getAccessRequest(actorId, requestId);
  if (req.status !== "pending") {
    throw new ConflictError(
      `La solicitud ya esta en status ${req.status}`,
      {},
    );
  }
  await db.execute(sql`
    UPDATE app.access_requests
    SET status = 'rejected',
        rejection_reason = ${reason},
        rejected_at = now(),
        rejected_by = ${actorId}
    WHERE id = ${requestId}
  `);
  return getAccessRequest(actorId, requestId);
}

export async function markAccessRequestSpam(
  actorId: string,
  requestId: string,
): Promise<AccessRequest> {
  await requireAdmin(actorId);
  await db.execute(sql`
    UPDATE app.access_requests SET status = 'spam' WHERE id = ${requestId}
  `);
  return getAccessRequest(actorId, requestId);
}

// =============================================================================
// Auto-approve domains (allowlist)
// =============================================================================

export type AutoApproveDomain = {
  domain: string;
  role: "admin" | "usuario";
  addedAt: string;
  notas: string | null;
};

export async function listAutoApproveDomains(
  actorId: string,
): Promise<AutoApproveDomain[]> {
  await requireAdmin(actorId);
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT domain, role, added_at, notas FROM app.access_auto_approve_domains
    ORDER BY domain ASC
  `);
  return rows.map((r) => ({
    domain: String(r.domain),
    role: (r.role as "admin" | "usuario") ?? "usuario",
    addedAt: toIso(r.added_at),
    notas: (r.notas as string | null) ?? null,
  }));
}

export async function addAutoApproveDomain(
  actorId: string,
  data: { domain: string; role?: "admin" | "usuario"; notas?: string | null },
): Promise<void> {
  await requireAdmin(actorId);
  const d = data.domain.trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
    throw new ValidationError(`Dominio invalido: ${data.domain}`, {});
  }
  await db.execute(sql`
    INSERT INTO app.access_auto_approve_domains (domain, role, added_by, notas)
    VALUES (${d}, ${data.role ?? "usuario"}, ${actorId}, ${data.notas ?? null})
    ON CONFLICT (domain) DO UPDATE SET role = EXCLUDED.role, notas = EXCLUDED.notas
  `);
}

export async function removeAutoApproveDomain(
  actorId: string,
  domain: string,
): Promise<void> {
  await requireAdmin(actorId);
  await db.execute(sql`
    DELETE FROM app.access_auto_approve_domains WHERE domain = ${domain.toLowerCase()}
  `);
}
