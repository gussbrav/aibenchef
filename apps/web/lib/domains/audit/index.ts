/**
 * Domain audit: vista unificada de eventos auditables.
 *
 * Combina:
 *   - auth.users_audit       (cambios de rol/status)
 *   - app.ai_providers_audit (cambios en api keys)
 *   - app.sql_audit_log      (queries SQL ejecutadas)
 *   - app.genie_history      (prompts NL2SQL)
 *
 * Solo admins pueden consultarlo.
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { toIso } from "@/lib/domains/shared";

export type AuditCategoria = "users" | "ai_providers" | "sql" | "genie";

export type AuditEvent = {
  id: string;
  categoria: AuditCategoria;
  accion: string;
  detalle: string | null;
  actorEmail: string | null;
  actorName: string | null;
  targetEmail: string | null;
  createdAt: string;
};

const LIMIT_DEFAULT = 200;

export async function listAuditEvents(opts: {
  categorias?: AuditCategoria[];
  limit?: number;
  desde?: string; // ISO date
} = {}): Promise<AuditEvent[]> {
  const cats = opts.categorias ?? ["users", "ai_providers", "sql", "genie"];
  const lim = Math.min(opts.limit ?? LIMIT_DEFAULT, 500);
  const desde = opts.desde ?? "1970-01-01";

  const result: AuditEvent[] = [];

  if (cats.includes("users")) {
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        SELECT ua.id::text AS id, 'users' AS categoria, ua.accion, ua.detalle,
               actor.email AS actor_email, actor.name AS actor_name,
               target.email AS target_email,
               ua.created_at
        FROM auth.users_audit ua
        LEFT JOIN auth.users actor ON ua.actor_id = actor.id
        LEFT JOIN auth.users target ON ua.user_id = target.id
        WHERE ua.created_at >= ${desde}::timestamptz
        ORDER BY ua.created_at DESC
        LIMIT ${lim}
      `,
    );
    for (const r of rows) result.push(mapRow(r, "users"));
  }

  if (cats.includes("ai_providers")) {
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        SELECT aa.id::text AS id, 'ai_providers' AS categoria,
               aa.accion, (aa.provider || ': ' || COALESCE(aa.detalle, '')) AS detalle,
               actor.email AS actor_email, actor.name AS actor_name,
               NULL::text AS target_email,
               aa.created_at
        FROM app.ai_providers_audit aa
        LEFT JOIN auth.users actor ON aa.user_id = actor.id
        WHERE aa.created_at >= ${desde}::timestamptz
        ORDER BY aa.created_at DESC
        LIMIT ${lim}
      `,
    );
    for (const r of rows) result.push(mapRow(r, "ai_providers"));
  }

  if (cats.includes("sql")) {
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        SELECT sa.id::text AS id, 'sql' AS categoria,
               CASE WHEN sa.exitoso THEN 'execute_ok' ELSE 'execute_failed' END AS accion,
               LEFT(sa.sql_text, 200) AS detalle,
               actor.email AS actor_email, actor.name AS actor_name,
               NULL::text AS target_email,
               sa.created_at
        FROM app.sql_audit_log sa
        LEFT JOIN auth.users actor ON sa.user_id = actor.id
        WHERE sa.created_at >= ${desde}::timestamptz
        ORDER BY sa.created_at DESC
        LIMIT ${lim}
      `,
    );
    for (const r of rows) result.push(mapRow(r, "sql"));
  }

  if (cats.includes("genie")) {
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        SELECT gh.id::text AS id, 'genie' AS categoria,
               CASE WHEN gh.exitoso THEN 'genie_ok' ELSE 'genie_failed' END AS accion,
               LEFT(gh.prompt, 200) AS detalle,
               actor.email AS actor_email, actor.name AS actor_name,
               NULL::text AS target_email,
               gh.created_at
        FROM app.genie_history gh
        LEFT JOIN auth.users actor ON gh.user_id = actor.id
        WHERE gh.created_at >= ${desde}::timestamptz
        ORDER BY gh.created_at DESC
        LIMIT ${lim}
      `,
    );
    for (const r of rows) result.push(mapRow(r, "genie"));
  }

  // Merge sort por created_at DESC
  result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return result.slice(0, lim);
}

function mapRow(r: Record<string, unknown>, categoria: AuditCategoria): AuditEvent {
  return {
    id: `${categoria}:${String(r.id)}`,
    categoria,
    accion: String(r.accion),
    detalle: (r.detalle as string | null) ?? null,
    actorEmail: (r.actor_email as string | null) ?? null,
    actorName: (r.actor_name as string | null) ?? null,
    targetEmail: (r.target_email as string | null) ?? null,
    createdAt: toIso(r.created_at),
  };
}
