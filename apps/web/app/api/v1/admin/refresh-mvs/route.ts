/**
 * /api/v1/admin/refresh-mvs
 *
 * POST (default)   → refresca las MVs del informe (rapido, <30 seg).
 *                     Usa marts.refresh_mvs_informe() — subset (mora,
 *                     cobertura CAR). Sync — bloquea el request hasta
 *                     terminar. Solo admins.
 *
 * POST ?all=true   → refresca TODAS las 24 MVs (lento, 30-60 min).
 *                     Encola un sync_job especial que el worker_daemon
 *                     detecta y procesa via refresh-marts --concurrent.
 *                     Retorna en <1 seg. Cualquier usuario logueado.
 *
 * GET              → preview del estado de las MVs (edad, tier, severity).
 *                     Cualquier usuario logueado.
 */

import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/infrastructure/db";
import { requireAdmin } from "@/lib/domains/users";
import { requireSession } from "@/lib/auth-helpers";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { handleRoute, UnauthorizedError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

type MvFreshnessRow = {
  mv_name: string;
  tier: string;
  sla_hours: number;
  age_hours: number;
  last_refresh_ok: string | null;
  severity: string;
};

export async function GET(_req: NextRequest) {
  return handleRoute(async () => {
    await requireSession();
    let rows: MvFreshnessRow[] = [];
    try {
      const raw = await db.execute<Record<string, unknown>>(sql`
        SELECT mv_name, tier, sla_hours, age_hours,
               TO_CHAR(last_refresh_ok, 'YYYY-MM-DD HH24:MI:SS') AS last_refresh_ok,
               severity
        FROM admin.v_mv_freshness
        ORDER BY age_hours DESC NULLS LAST
      `);
      rows = raw.map((r) => ({
        mv_name: String(r.mv_name),
        tier: String(r.tier),
        sla_hours: Number(r.sla_hours),
        age_hours: r.age_hours == null ? 0 : Number(r.age_hours),
        last_refresh_ok: r.last_refresh_ok == null ? null : String(r.last_refresh_ok),
        severity: String(r.severity),
      }));
    } catch {
      /* silent — vista puede no existir en DBs antiguas */
    }
    const nStale = rows.filter((r) => r.severity !== "ok").length;
    const maxAgeHours = rows.reduce((max, r) => Math.max(max, r.age_hours), 0);
    return {
      total: rows.length,
      nStale,
      maxAgeHours: Math.round(maxAgeHours * 10) / 10,
      mvs: rows.slice(0, 30),
    };
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const url = new URL(req.url);
    const isAll = url.searchParams.get("all") === "true";

    if (isAll) {
      // Refresh completo — encola sync_job, el worker_daemon lo procesa.
      const session = await requireSession();
      const inserted = await db.execute<{ id: number }>(sql`
        INSERT INTO admin.sync_jobs (
          periodo_desde, periodo_hasta,
          topicos,
          triggered_by, triggered_by_email
        )
        SELECT 0, 0,
               ARRAY['__refresh_mvs__']::text[],
               'refresh-mvs-ui', ${session.email}::text
        WHERE NOT EXISTS (
          SELECT 1 FROM admin.sync_jobs
          WHERE status IN ('pending', 'running')
            AND periodo_desde = 0
            AND topicos = ARRAY['__refresh_mvs__']::text[]
        )
        RETURNING id
      `);
      const jobId = inserted[0]?.id ?? null;
      const alreadyRunning = jobId === null;

      const hdrs = await headers();
      const ctxAudit = extractAuditContext(hdrs, session.id, session.email);
      await recordAuditEvent({
        ...ctxAudit,
        category: "schema",
        action: "refresh_mvs_all_triggered",
        severity: "info",
        resource: `sync_job:${jobId ?? "already_running"}`,
        metadata: { jobId, alreadyRunning, scope: "all_mvs" },
      });

      return {
        ok: true,
        scope: "all_mvs",
        jobId,
        alreadyRunning,
        mensaje: alreadyRunning
          ? "Ya hay un refresh completo en curso — no encolo duplicado."
          : `Refresh completo encolado (job #${jobId}). El worker lo procesa en <1 seg (LISTEN/NOTIFY V160). El refresh real tarda 30-60 min según el tamaño de las MVs. Refresca este panel en unos minutos para ver el progreso.`,
      };
    }

    // Refresh subset (informe) — sync, requiere admin.
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);
    const rows = await db.execute<{
      mv_name: string;
      refreshed_at: string;
      success: boolean;
      error: string | null;
    }>(sql`SELECT mv_name, refreshed_at, success, error FROM marts.refresh_mvs_informe()`);

    revalidateTag("informe");
    revalidateTag("periodos");
    revalidateTag("entidades");

    return {
      scope: "informe_subset",
      results: rows.map((r) => ({
        mv: String(r.mv_name),
        refreshedAt: r.refreshed_at,
        success: Boolean(r.success),
        error: r.error,
      })),
      cachesInvalidated: ["informe", "periodos", "entidades"],
    };
  });
}
