/**
 * Endpoint admin: force recheck de archivos SBS marcados stale
 * (no_publicado_sbs con actualizado_en < fecha_esperada + lag*1.5).
 *
 * Reemplaza la ejecucion manual del CLI:
 *   docker exec <container> aibenchef sbs recheck-stale-no-publicados
 *
 * Asi el usuario admin dispara el recheck desde el browser (boton en
 * /dashboard/admin/data-quality) sin necesidad de SSH ni acceso a
 * consola del container.
 *
 * GET  → devuelve la lista actual de archivos stale (preview).
 * POST → encola sync_jobs por cada periodo stale con force_redownload=true.
 *
 * NO borra archivos locales corruptos (el web container no comparte fs
 * con aibenchef-data). El fix es delegado al downloader: force_redownload=true
 * + magic-byte check nuevo (V158) → si el .xls local es HTML basura, el
 * downloader lo detecta, borra, y re-descarga correcto. Cero garbage
 * permanente en disco.
 */

import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { db } from "@/lib/infrastructure/db";
import { requireSession } from "@/lib/auth-helpers";
import { isAdmin } from "@/lib/domains/users";
import { extractAuditContext, recordAuditEvent } from "@/lib/domains/governance";
import { ForbiddenError, handleRoute, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

type StaleRow = {
  periodo: number;
  grupo: string;
  topico: string;
  path_local: string;
  actualizado_en: string;
  dias_stale: number;
};

async function fetchStaleRows(): Promise<StaleRow[]> {
  try {
    const rows = await db.execute<StaleRow>(sql`
      SELECT periodo, grupo, topico, path_local, actualizado_en, dias_stale
      FROM admin.v_no_publicados_stale
      ORDER BY dias_stale DESC, periodo DESC
      LIMIT 200
    `);
    return rows.map((r) => ({
      periodo: Number(r.periodo),
      grupo: String(r.grupo),
      topico: String(r.topico),
      path_local: String(r.path_local),
      actualizado_en: String(r.actualizado_en),
      dias_stale: Number(r.dias_stale),
    }));
  } catch {
    // Vista no existe aun (V157 pendiente en esta DB) — devolver vacio.
    return [];
  }
}

export async function GET(_req: NextRequest) {
  return handleRoute(async () => {
    await requireSession();
    const rows = await fetchStaleRows();
    // Resumen por periodo — util para mostrar summary en el UI.
    const porPeriodo = new Map<number, {
      grupos: Set<string>;
      topicos: Set<string>;
      maxDias: number;
      archivos: StaleRow[];
    }>();
    for (const r of rows) {
      const p = porPeriodo.get(r.periodo) ?? {
        grupos: new Set<string>(),
        topicos: new Set<string>(),
        maxDias: 0,
        archivos: [] as StaleRow[],
      };
      p.grupos.add(r.grupo);
      p.topicos.add(r.topico);
      p.maxDias = Math.max(p.maxDias, r.dias_stale);
      p.archivos.push(r);
      porPeriodo.set(r.periodo, p);
    }
    const resumen = Array.from(porPeriodo.entries())
      .map(([periodo, v]) => ({
        periodo,
        gruposFaltantes: Array.from(v.grupos).sort(),
        topicosAfectados: Array.from(v.topicos).sort(),
        diasStaleMax: v.maxDias,
        totalArchivos: v.archivos.length,
        // NUEVO: archivos individuales con filename extraido del path_local
        // — asi el UI puede mostrar exactamente que .xls esta pendiente
        // (ej: "B-2358-ab2024.xls") y cuando fue el ultimo intento.
        archivos: v.archivos.map((a) => ({
          filename: a.path_local.split(/[/\\]/).pop() ?? a.path_local,
          grupo: a.grupo,
          topico: a.topico,
          actualizado_en: a.actualizado_en,
          dias_stale: a.dias_stale,
        })),
      }))
      .sort((a, b) => b.periodo - a.periodo);

    // NUEVO: sync jobs pending/running actuales — para que el UI muestre
    // cuantos jobs estan en cola y linkee a /admin/pipeline para el detalle.
    let syncJobsActivos: Array<{
      id: number;
      periodo: number;
      status: string;
      triggered_by: string;
      requested_at: string;
    }> = [];
    try {
      const jobs = await db.execute<{
        id: number;
        periodo_desde: number;
        status: string;
        triggered_by: string;
        requested_at: string;
      }>(sql`
        SELECT id, periodo_desde, status, triggered_by,
               TO_CHAR(requested_at, 'YYYY-MM-DD HH24:MI:SS') AS requested_at
        FROM admin.sync_jobs
        WHERE status IN ('pending', 'running')
        ORDER BY requested_at DESC
        LIMIT 20
      `);
      syncJobsActivos = jobs.map((j) => ({
        id: Number(j.id),
        periodo: Number(j.periodo_desde),
        status: String(j.status),
        triggered_by: String(j.triggered_by),
        requested_at: String(j.requested_at),
      }));
    } catch {
      /* silent — tabla no accesible desde este container */
    }

    return {
      total: rows.length,
      resumen,
      archivos: rows,
      syncJobsActivos,
    };
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const session = await requireSession();
    if (!(await isAdmin(session.id))) {
      throw new ForbiddenError("Solo admins pueden encolar re-descargas", {});
    }

    // V178: si se especifica ?periodo=YYYYMM, se re-verifica ese periodo
    // en particular (aunque no este "stale" oficialmente). Sirve para el
    // boton "Verificar de nuevo con SBS" del popover del badge — el admin
    // puede desatascar un periodo apenas ve que SBS ya publico, sin
    // esperar los 37 dias del stale threshold.
    const url = new URL(req.url);
    const periodoParam = url.searchParams.get("periodo");
    let periodos: number[];
    let staleRows: StaleRow[] = [];

    if (periodoParam) {
      const p = Number.parseInt(periodoParam, 10);
      if (!Number.isFinite(p) || p < 200001 || p > 210012) {
        throw new ValidationError("periodo invalido (YYYYMM)", {});
      }
      periodos = [p];
    } else {
      staleRows = await fetchStaleRows();
      if (staleRows.length === 0) {
        return {
          ok: true,
          encolados: 0,
          skipeados: 0,
          mensaje: "No hay archivos stale — nada que hacer.",
        };
      }
      periodos = Array.from(new Set(staleRows.map((r) => r.periodo))).sort((a, b) => b - a);
    }

    let encolados = 0;
    let skipeados = 0;
    const jobIds: number[] = [];

    for (const periodo of periodos) {
      const inserted = await db.execute<{ id: number }>(sql`
        INSERT INTO admin.sync_jobs (
          periodo_desde, periodo_hasta,
          force_redownload,
          triggered_by, triggered_by_email
        )
        SELECT ${periodo}, ${periodo}, true,
               'recheck-stale-ui', ${session.email}::text
        WHERE NOT EXISTS (
          SELECT 1 FROM admin.sync_jobs
          WHERE status IN ('pending', 'running')
            AND periodo_desde = ${periodo}
            AND periodo_hasta = ${periodo}
        )
        RETURNING id
      `);
      const row = inserted[0];
      if (row?.id != null) {
        encolados++;
        jobIds.push(Number(row.id));
      } else {
        skipeados++;
      }
    }

    // Audit log
    const hdrs = await headers();
    const ctxAudit = extractAuditContext(hdrs, session.id, session.email);
    await recordAuditEvent({
      ...ctxAudit,
      category: "schema",
      action: "recheck_stale_encolado",
      severity: "info",
      resource: `sync_jobs:${jobIds.join(",")}`,
      metadata: {
        periodos,
        totalArchivosStale: staleRows.length,
        encolados,
        skipeados,
        jobIds,
      },
    });

    return {
      ok: true,
      encolados,
      skipeados,
      jobIds,
      periodos,
      totalArchivosStale: staleRows.length,
      mensaje:
        encolados > 0
          ? `${encolados} sync jobs encolados con force_redownload=true. El worker (aibenchef-data) los procesa en los próximos minutos.`
          : "Todos los períodos afectados ya tienen un sync job pending/running.",
    };
  });
}
