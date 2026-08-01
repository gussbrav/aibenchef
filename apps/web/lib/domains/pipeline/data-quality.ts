/**
 * Data Quality domain — Pilares 1 + 4 (Completeness + Freshness).
 *
 * Introducido por V136 + V137 tras el incidente C-4103-my2026 (jul-2026).
 * Consumido por /dashboard/admin/data-quality.
 *
 * Fuentes:
 *   - admin.v_missing_files          — completeness (V136)
 *   - admin.v_data_freshness         — freshness (V137)
 *   - raw.v_archivos_sospechosos     — partial ingest (V135)
 *   - admin.data_quality_checks      — consistency (V093)
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";

/* ──────────────────────────────────────────────────────────────────────── */
/* Tipos                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

export type DQSeverity = "critical" | "warning" | "info" | "ok" | "never_refreshed";

export type MissingFileRow = {
  periodo: number;
  grupo: string;
  topico: string;
  nEsperados: number;
  nEncontrados: number;
  nFaltantes: number;
  publishLagDays: number;
  fechaEsperada: string;
  isOverdue: boolean;
  severity: DQSeverity;
};

export type FreshnessRow = {
  mvName: string;
  tier: "critical" | "important" | "analytical";
  slaHours: number;
  lastSuccessfulRefresh: string | null;
  lastAnyRefresh: string | null;
  lastRunSuccess: boolean | null;
  lastError: string | null;
  ageHours: number | null;
  triggeredBy: string | null;
  severity: DQSeverity;
};

export type SospechosoRow = {
  id: string;
  periodo: number;
  grupo: string;
  topico: string;
  nombreArchivo: string;
  filasInsertadas: number | null;
  status: string;
  errorMensaje: string | null;
  procesadoEn: string | null;
  checkResult: Record<string, unknown> | null;
};

export type DataQualityScore = {
  overall: number;                 // 0-100
  completeness: number;
  freshness: number;
  ingestQuality: number;
  reconciliation: number;
  detalle: {
    missingCriticos: number;
    missingWarnings: number;
    mvsStaleCriticas: number;
    mvsStaleAnaliticas: number;
    sospechosos: number;
    reconciliacionCritical: number;
    reconciliacionWarning: number;
  };
};

export type ReconciliacionRow = {
  periodo: number;
  tipoEstado: string;
  moneda: string;
  nRaw: number;
  nMarts: number;
  delta: number;
  severity: DQSeverity;
  detail: string;
};

/* ──────────────────────────────────────────────────────────────────────── */
/* Queries                                                                  */
/* ──────────────────────────────────────────────────────────────────────── */

export async function listMissingFiles(limit = 100): Promise<MissingFileRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT periodo, grupo, topico, n_esperados, n_encontrados, n_faltantes,
           publish_lag_days, fecha_esperada, is_overdue, severity
      FROM admin.v_missing_files
     LIMIT ${limit}
  `);
  return rows.map((r) => ({
    periodo: Number(r.periodo),
    grupo: String(r.grupo),
    topico: String(r.topico),
    nEsperados: Number(r.n_esperados),
    nEncontrados: Number(r.n_encontrados),
    nFaltantes: Number(r.n_faltantes),
    publishLagDays: Number(r.publish_lag_days),
    fechaEsperada: String(r.fecha_esperada),
    isOverdue: Boolean(r.is_overdue),
    severity: String(r.severity) as DQSeverity,
  }));
}

export async function listFreshness(): Promise<FreshnessRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT mv_name, tier, sla_hours,
           last_successful_refresh, last_any_refresh, last_run_success,
           last_error, age_hours, last_triggered_by, severity
      FROM admin.v_data_freshness
  `);
  return rows.map((r) => ({
    mvName: String(r.mv_name),
    tier: String(r.tier) as FreshnessRow["tier"],
    slaHours: Number(r.sla_hours),
    lastSuccessfulRefresh: r.last_successful_refresh
      ? String(r.last_successful_refresh)
      : null,
    lastAnyRefresh: r.last_any_refresh ? String(r.last_any_refresh) : null,
    lastRunSuccess: r.last_run_success == null ? null : Boolean(r.last_run_success),
    lastError: r.last_error == null ? null : String(r.last_error),
    ageHours: r.age_hours == null ? null : Number(r.age_hours),
    triggeredBy: r.last_triggered_by == null ? null : String(r.last_triggered_by),
    severity: String(r.severity) as DQSeverity,
  }));
}

export async function listSospechosos(limit = 50): Promise<SospechosoRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT id::text AS id, periodo, grupo, topico, nombre_archivo,
           filas_insertadas, status, error_mensaje, procesado_en, check_result
      FROM raw.v_archivos_sospechosos
     LIMIT ${limit}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    periodo: Number(r.periodo),
    grupo: String(r.grupo),
    topico: String(r.topico),
    nombreArchivo: String(r.nombre_archivo),
    filasInsertadas: r.filas_insertadas == null ? null : Number(r.filas_insertadas),
    status: String(r.status),
    errorMensaje: r.error_mensaje == null ? null : String(r.error_mensaje),
    procesadoEn: r.procesado_en == null ? null : String(r.procesado_en),
    checkResult:
      typeof r.check_result === "object" && r.check_result !== null
        ? (r.check_result as Record<string, unknown>)
        : null,
  }));
}

export async function listReconciliacion(): Promise<ReconciliacionRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT periodo, tipo_estado, moneda, n_raw, n_marts, delta, severity, detail
      FROM admin.v_reconciliacion_recent
  `);
  return rows.map((r) => ({
    periodo: Number(r.periodo),
    tipoEstado: String(r.tipo_estado),
    moneda: String(r.moneda),
    nRaw: Number(r.n_raw),
    nMarts: Number(r.n_marts),
    delta: Number(r.delta),
    severity: String(r.severity) as DQSeverity,
    detail: String(r.detail),
  }));
}

/**
 * Data Quality Score compuesto (0-100). Componentes:
 *  - Completeness: penaliza missing criticos (2pt) y warnings (1pt).
 *  - Freshness: penaliza MVs criticas stale (3pt) y analiticas stale (1pt).
 *  - IngestQuality: penaliza archivos sospechosos recientes (2pt).
 *  - Reconciliation: penaliza divergencias raw<->marts (crit 5pt, warn 2pt).
 * Overall = promedio simple de los 4.
 */
export async function getDataQualityScore(): Promise<DataQualityScore> {
  const [{ rows: missingRows }, { rows: freshRows }, { rows: sospRows }, { rows: reconRows }] =
    await Promise.all([
      db
        .execute<{ severity: string; n: number }>(sql`
          SELECT severity, COUNT(*)::int AS n FROM admin.v_missing_files GROUP BY 1
        `)
        .then((r) => ({ rows: r })),
      db
        .execute<{ tier: string; severity: string; n: number }>(sql`
          SELECT tier, severity, COUNT(*)::int AS n
            FROM admin.v_data_freshness
           GROUP BY 1, 2
        `)
        .then((r) => ({ rows: r })),
      db
        .execute<{ n: number }>(sql`
          SELECT COUNT(*)::int AS n
            FROM raw.v_archivos_sospechosos
           WHERE periodo >= (SELECT COALESCE(MAX(periodo) - 6, 0) FROM raw.archivos_descargados)
        `)
        .then((r) => ({ rows: r })),
      db
        .execute<{ severity: string; n: number }>(sql`
          SELECT severity, COUNT(*)::int AS n
            FROM admin.v_reconciliacion_recent GROUP BY 1
        `)
        .then((r) => ({ rows: r })),
    ]);

  const missingCriticos = missingRows.find((r) => r.severity === "critical")?.n ?? 0;
  const missingWarnings = missingRows.find((r) => r.severity === "warning")?.n ?? 0;

  const mvsStaleCriticas = freshRows
    .filter(
      (r) =>
        (r.tier === "critical" || r.tier === "important") &&
        (r.severity === "critical" || r.severity === "warning"),
    )
    .reduce((acc, r) => acc + Number(r.n), 0);
  const mvsStaleAnaliticas = freshRows
    .filter((r) => r.tier === "analytical" && r.severity !== "ok")
    .reduce((acc, r) => acc + Number(r.n), 0);

  const sospechosos = Number(sospRows[0]?.n ?? 0);
  const reconciliacionCritical = reconRows.find((r) => r.severity === "critical")?.n ?? 0;
  const reconciliacionWarning = reconRows.find((r) => r.severity === "warning")?.n ?? 0;

  const completeness = Math.max(0, 100 - missingCriticos * 2 - missingWarnings * 1);
  const freshness = Math.max(0, 100 - mvsStaleCriticas * 3 - mvsStaleAnaliticas * 1);
  const ingestQuality = Math.max(0, 100 - sospechosos * 2);
  const reconciliation = Math.max(
    0,
    100 - reconciliacionCritical * 5 - reconciliacionWarning * 2,
  );
  const overall = Math.round(
    (completeness + freshness + ingestQuality + reconciliation) / 4,
  );

  return {
    overall,
    completeness,
    freshness,
    ingestQuality,
    reconciliation,
    detalle: {
      missingCriticos,
      missingWarnings,
      mvsStaleCriticas,
      mvsStaleAnaliticas,
      sospechosos,
      reconciliacionCritical,
      reconciliacionWarning,
    },
  };
}
