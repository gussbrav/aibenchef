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
import { requireAdminSession } from "@/lib/auth-helpers";
import { extractAuditContext, recordAuditEvent } from "@/lib/domains/governance";
import { handleRoute } from "@/lib/domains/shared";

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
    await requireAdminSession();
    const rows = await fetchStaleRows();
    // Resumen por periodo — util para mostrar summary en el UI.
    const porPeriodo = new Map<number, { grupos: Set<string>; topicos: Set<string>; maxDias: number }>();
    for (const r of rows) {
      const p = porPeriodo.get(r.periodo) ?? {
        grupos: new Set<string>(),
        topicos: new Set<string>(),
        maxDias: 0,
      };
      p.grupos.add(r.grupo);
      p.topicos.add(r.topico);
      p.maxDias = Math.max(p.maxDias, r.dias_stale);
      porPeriodo.set(r.periodo, p);
    }
    const resumen = Array.from(porPeriodo.entries())
      .map(([periodo, v]) => ({
        periodo,
        gruposFaltantes: Array.from(v.grupos).sort(),
        topicosAfectados: Array.from(v.topicos).sort(),
        diasStaleMax: v.maxDias,
        totalArchivos: rows.filter((r) => r.periodo === periodo).length,
      }))
      .sort((a, b) => b.periodo - a.periodo);
    return {
      total: rows.length,
      resumen,
      archivos: rows,
    };
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const session = await requireAdminSession();
    const rows = await fetchStaleRows();

    if (rows.length === 0) {
      return {
        ok: true,
        encolados: 0,
        skipeados: 0,
        mensaje: "No hay archivos stale — nada que hacer.",
      };
    }

    // Agrupar por periodo (dedup) y encolar 1 sync_job por periodo con
    // force_redownload=true. El worker (aibenchef-data container) toma
    // los jobs en su proximo ciclo y re-baja los archivos.
    const periodos = Array.from(new Set(rows.map((r) => r.periodo))).sort((a, b) => b - a);

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
        totalArchivosStale: rows.length,
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
      totalArchivosStale: rows.length,
      mensaje:
        encolados > 0
          ? `${encolados} sync jobs encolados con force_redownload=true. El worker (aibenchef-data) los procesa en los próximos minutos.`
          : "Todos los períodos afectados ya tienen un sync job pending/running.",
    };
  });
}
