/**
 * Queries del domain pipeline (observability) — issue #18.
 *
 * Lee raw.carga_log + admin.estructura_diffs + marts.v_entidades_delta
 * + raw.archivos_descargados para alimentar /dashboard/admin/pipeline.
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";

import type {
  AnomaliaRow,
  CoberturaRow,
  EntidadDelta,
  PipelineHealth,
  TimelineEntry,
  StageName,
  Severity,
  CargaStatus,
  DiffAction,
} from "./types";

/* ──────────────────────────────────────────────────────────────────────── */
/* PipelineHealth                                                            */
/* ──────────────────────────────────────────────────────────────────────── */

const STAGES_TRACKED: StageName[] = ["scrape", "import", "refresh-mvs", "detectar-cambios"];

export async function getPipelineHealth(): Promise<PipelineHealth> {
  // Última corrida por stage. Hardcodeamos las stages como literal SQL porque
  // pasar un JS array via `${arr}::text[]` falla en postgres-js (intenta castear
  // record → text[], code 42846). La lista de stages es enum cerrado, asi que
  // hardcodear es seguro y elimina serialization issues.
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT DISTINCT ON (stage)
      stage,
      status,
      started_at,
      EXTRACT(EPOCH FROM (finished_at - started_at))::numeric AS duration_s
    FROM raw.carga_log
    WHERE stage IN ('scrape', 'import', 'refresh-mvs', 'detectar-cambios')
    ORDER BY stage, started_at DESC
  `);

  const byStageMap = new Map<StageName, (typeof rows)[0]>();
  for (const r of rows) {
    byStageMap.set(r.stage as StageName, r);
  }

  const byStage = STAGES_TRACKED.map((stage) => {
    const r = byStageMap.get(stage);
    return {
      stage,
      lastRun: r ? new Date(r.started_at as string).toISOString() : null,
      status: r ? ((r.status as CargaStatus) ?? null) : null,
      durationSeconds: r?.duration_s != null ? Number(r.duration_s) : null,
    };
  });

  // Data freshness — mas reciente periodo con observation rows.
  const freshnessRows = await db.execute<{ ultimo_periodo: number | null }>(sql`
    SELECT MAX(periodo)::int AS ultimo_periodo FROM raw.eeff_observacion
  `);
  const ultimoPeriodoIngestado = freshnessRows[0]?.ultimo_periodo ?? null;

  // Lag en meses: comparar con el mes anterior al actual (SBS publica con
  // 1-2 meses de delay, asi que lag=1 es normal, lag=3+ es alerta).
  let lagMeses: number | null = null;
  let semaforo: PipelineHealth["dataFreshness"]["semaforo"] = "red";
  if (ultimoPeriodoIngestado != null) {
    const now = new Date();
    const yearActual = now.getUTCFullYear();
    const mesActual = now.getUTCMonth() + 1;
    // Mes anterior (target esperado de data).
    let yearEsperado = yearActual;
    let mesEsperado = mesActual - 1;
    if (mesEsperado === 0) {
      mesEsperado = 12;
      yearEsperado--;
    }
    const periodoEsperado = yearEsperado * 100 + mesEsperado;

    const yearIng = Math.floor(ultimoPeriodoIngestado / 100);
    const mesIng = ultimoPeriodoIngestado % 100;
    lagMeses =
      (yearEsperado - yearIng) * 12 + (mesEsperado - mesIng);

    if (lagMeses <= 1) semaforo = "green";
    else if (lagMeses <= 2) semaforo = "amber";
    else semaforo = "red";

    // Si tenemos el periodo esperado, semaforo green (override).
    if (ultimoPeriodoIngestado >= periodoEsperado) semaforo = "green";
  }

  return {
    byStage,
    dataFreshness: {
      ultimoPeriodoIngestado,
      lagMeses,
      semaforo,
    },
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Cobertura del último periodo                                              */
/* ──────────────────────────────────────────────────────────────────────── */

export async function getCobertura(periodo: number): Promise<CoberturaRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      topico,
      grupo,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'procesado')::int AS procesados,
      COUNT(*) FILTER (WHERE status = 'error')::int AS errores,
      COUNT(*) FILTER (WHERE status IN ('descargado','procesando'))::int AS pendientes,
      COUNT(*) FILTER (WHERE status = 'no_publicado_sbs')::int AS no_publicados
    FROM raw.archivos_descargados
    WHERE periodo = ${periodo}
    GROUP BY topico, grupo
    ORDER BY topico, grupo
  `);

  return rows.map((r) => {
    const total = Number(r.total);
    const procesados = Number(r.procesados);
    const noPublicados = Number(r.no_publicados);
    // pct se calcula sobre archivos esperados (excluyendo no_publicado_sbs
    // que son gaps reales de SBS, no fallas del pipeline).
    const esperados = total - noPublicados;
    const pctCompletado = esperados === 0 ? 100 : Math.round((procesados / esperados) * 100);
    return {
      topico: r.topico as string,
      grupo: r.grupo as string,
      totalArchivos: total,
      procesados,
      errores: Number(r.errores),
      pendientes: Number(r.pendientes),
      noPublicados,
      pctCompletado,
    };
  });
}

/** Helper: devuelve el periodo más reciente con archivos en archivos_descargados. */
export async function getUltimoPeriodoConArchivos(): Promise<number | null> {
  const rows = await db.execute<{ p: number | null }>(sql`
    SELECT MAX(periodo)::int AS p FROM raw.archivos_descargados
  `);
  return rows[0]?.p ?? null;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Anomalías estructurales                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

export async function listAnomalias(opts: {
  periodo?: number;
  unreviewed?: boolean;
  severity?: Severity;
  limit?: number;
} = {}): Promise<AnomaliaRow[]> {
  const limit = opts.limit ?? 100;
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      id::int,
      periodo,
      grupo,
      topico,
      tipo_estado AS "tipoEstado",
      detected_at,
      n_renames AS "nRenames",
      n_extras  AS "nExtras",
      n_missing AS "nMissing",
      severity,
      payload,
      reviewed_at,
      reviewed_by AS "reviewedBy",
      review_action AS "reviewAction"
    FROM admin.estructura_diffs
    WHERE
      (${opts.periodo ?? null}::int   IS NULL OR periodo  = ${opts.periodo ?? null}::int)
      AND (${opts.severity ?? null}::text IS NULL OR severity = ${opts.severity ?? null}::text)
      AND (
        ${opts.unreviewed ?? false}::boolean = FALSE
        OR reviewed_at IS NULL
      )
    ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      detected_at DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    id: Number(r.id),
    periodo: Number(r.periodo),
    grupo: r.grupo as string,
    topico: r.topico as string,
    tipoEstado: (r.tipoEstado as string | null) ?? null,
    detectedAt: new Date(r.detected_at as string).toISOString(),
    nRenames: Number(r.nRenames),
    nExtras: Number(r.nExtras),
    nMissing: Number(r.nMissing),
    severity: r.severity as Severity,
    payload: (r.payload as Record<string, unknown>) ?? {},
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at as string).toISOString() : null,
    reviewedBy: (r.reviewedBy as string | null) ?? null,
    reviewAction: (r.reviewAction as string | null) ?? null,
  }));
}

export async function reviewAnomalia(
  id: number,
  reviewedBy: string,
  action: string,
  notes?: string,
): Promise<{ updated: number }> {
  const rows = await db.execute<{ id: number }>(sql`
    UPDATE admin.estructura_diffs
       SET reviewed_at = NOW(),
           reviewed_by = ${reviewedBy},
           review_action = ${action},
           review_notes = ${notes ?? null}
     WHERE id = ${id}
       AND reviewed_at IS NULL
     RETURNING id
  `);
  return { updated: rows.length };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Entidades delta                                                           */
/* ──────────────────────────────────────────────────────────────────────── */

export async function listEntidadesDelta(): Promise<EntidadDelta[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      periodo_actual,
      periodo_previo,
      tipo_entidad,
      nomb_correg,
      accion,
      en_maestra
    FROM marts.v_entidades_delta
    ORDER BY accion DESC, tipo_entidad, nomb_correg
  `);

  return rows.map((r) => ({
    periodoActual: Number(r.periodo_actual),
    periodoPrevio: Number(r.periodo_previo),
    tipoEntidad: r.tipo_entidad as string,
    nombCorreg: r.nomb_correg as string,
    accion: r.accion as DiffAction,
    enMaestra: Boolean(r.en_maestra),
  }));
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Timeline de corridas                                                      */
/* ──────────────────────────────────────────────────────────────────────── */

export async function getTimeline(limit = 20): Promise<TimelineEntry[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      id::int,
      stage,
      topico,
      periodo,
      status,
      started_at,
      finished_at,
      EXTRACT(EPOCH FROM (finished_at - started_at))::numeric AS duration_s,
      rows_inserted,
      triggered_by,
      error_message
    FROM raw.carga_log
    ORDER BY started_at DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    id: Number(r.id),
    stage: (r.stage as StageName | null) ?? null,
    topico: (r.topico as string | null) ?? null,
    periodo: r.periodo != null ? Number(r.periodo) : null,
    status: r.status as CargaStatus,
    startedAt: new Date(r.started_at as string).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at as string).toISOString() : null,
    durationSeconds: r.duration_s != null ? Number(r.duration_s) : null,
    rowsInserted: Number(r.rows_inserted ?? 0),
    triggeredBy: (r.triggered_by as string | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
  }));
}
