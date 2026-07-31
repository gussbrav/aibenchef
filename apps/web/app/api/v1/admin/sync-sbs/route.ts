/**
 * Endpoint para encolar un job de sincronizacion SBS.
 * Lo ejecuta `aibenchef sbs work-jobs` (worker CLI corrido por cron).
 *
 * POST /api/v1/admin/sync-sbs
 *   body: { periodoDesde, periodoHasta, topicos?: string[], grupos?: string[] }
 *
 * GET /api/v1/admin/sync-sbs
 *   ?status=pending|running|completed|failed (filtro opcional)
 *   ?limit=20 (default 20, max 100)
 *   Devuelve los ultimos N jobs.
 */

import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { db } from "@/lib/infrastructure/db";
import { requireSession } from "@/lib/auth-helpers";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { handleRoute, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const session = await requireSession();
    const body = (await req.json()) as {
      periodoDesde?: number;
      periodoHasta?: number;
      topicos?: string[];
      grupos?: string[];
      forceRedownload?: boolean;
    };

    const desde = Number(body.periodoDesde);
    const hasta = Number(body.periodoHasta);
    if (!Number.isFinite(desde) || !Number.isFinite(hasta) || desde < 200001 || hasta < desde) {
      throw new ValidationError("periodoDesde y periodoHasta son requeridos (YYYYMM, hasta >= desde)");
    }
    const topicos = body.topicos && body.topicos.length > 0 ? body.topicos : null;
    const grupos = body.grupos && body.grupos.length > 0 ? body.grupos : null;
    const forceRedownload = body.forceRedownload === true;

    const rows = await db.execute<{ id: number }>(sql`
      INSERT INTO admin.sync_jobs (
        periodo_desde, periodo_hasta, topicos, grupos,
        force_redownload,
        triggered_by, triggered_by_email
      ) VALUES (
        ${desde}, ${hasta},
        ${topicos as unknown as string}::text[],
        ${grupos as unknown as string}::text[],
        ${forceRedownload}::boolean,
        'manual',
        ${session.email ?? null}::text
      )
      RETURNING id
    `);

    const jobId = rows[0]?.id ?? null;
    const hdrs = await headers();
    const ctxAudit = extractAuditContext(hdrs, session.id, session.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "schema",
      action: "sync_sbs_enqueued",
      severity: "info",
      resource: `sync_job:${jobId}`,
      metadata: {
        periodoDesde: desde,
        periodoHasta: hasta,
        topicos,
        grupos,
        forceRedownload,
      },
    });

    return {
      ok: true,
      jobId,
      mensaje: "Job encolado. El worker lo tomara en los proximos minutos.",
    };
  });
}

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await requireSession();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
    const validStatus = ["pending", "running", "completed", "failed", "cancelled"];
    const statusFilter = status && validStatus.includes(status) ? status : null;

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id, periodo_desde AS "periodoDesde", periodo_hasta AS "periodoHasta",
             topicos, grupos,
             COALESCE(force_redownload, false) AS "forceRedownload",
             status,
             archivos_descargados AS "archivosDescargados",
             archivos_cambiados   AS "archivosCambiados",
             filas_importadas     AS "filasImportadas",
             log_text             AS "logText",
             error_mensaje        AS "errorMensaje",
             triggered_by         AS "triggeredBy",
             triggered_by_email   AS "triggeredByEmail",
             TO_CHAR(requested_at, 'YYYY-MM-DD HH24:MI:SS') AS "requestedAt",
             TO_CHAR(started_at,   'YYYY-MM-DD HH24:MI:SS') AS "startedAt",
             TO_CHAR(completed_at, 'YYYY-MM-DD HH24:MI:SS') AS "completedAt",
             duracion_seg AS "duracionSeg"
      FROM admin.sync_jobs
      WHERE (${statusFilter}::text IS NULL OR status = ${statusFilter}::text)
      ORDER BY requested_at DESC
      LIMIT ${limit}
    `);

    return { jobs: rows };
  });
}
