/**
 * Tipos del domain pipeline (observability) — issue #18.
 *
 * Modelo de datos para /dashboard/admin/pipeline:
 * - PipelineHealth: ultima corrida por stage + lag de data
 * - CoberturaRow: % completado por (topico, grupo) en un periodo
 * - AnomaliaRow: fila de admin.estructura_diffs sin revisar
 * - EntidadDelta: entidad nueva o desaparecida vs periodo previo
 * - TimelineEntry: corrida del pipeline (raw.carga_log)
 */

export type StageName = "scrape" | "import" | "refresh-mvs" | "detectar-cambios" | "backfill";
export type CargaStatus = "running" | "success" | "failed";
export type Severity = "info" | "warning" | "critical";
export type DiffAction = "nueva" | "desaparecida";

/** Estado del pipeline visto en /admin/pipeline section 1 — Salud */
export type PipelineHealth = {
  /** Ultima corrida exitosa por stage. */
  byStage: {
    stage: StageName;
    lastRun: string | null; // ISO string
    status: CargaStatus | null;
    durationSeconds: number | null;
  }[];
  /** Lag de la data publicada vs hoy. */
  dataFreshness: {
    /** YYYYMM mas reciente con data en raw.eeff_observacion. */
    ultimoPeriodoIngestado: number | null;
    /** Diferencia en meses vs el mes anterior al actual. */
    lagMeses: number | null;
    /** Diagnostico semafor: green | amber | red. */
    semaforo: "green" | "amber" | "red";
  };
};

/** Una fila de la tabla de cobertura por (topico, grupo) para un periodo. */
export type CoberturaRow = {
  topico: string;
  grupo: string;
  totalArchivos: number;
  procesados: number;
  errores: number;
  pendientes: number;
  noPublicados: number;
  pctCompletado: number; // 0..100
};

/** Una anomalia estructural detectada en admin.estructura_diffs. */
export type AnomaliaRow = {
  id: number;
  periodo: number;
  grupo: string;
  topico: string;
  tipoEstado: string | null;
  detectedAt: string; // ISO
  nRenames: number;
  nExtras: number;
  nMissing: number;
  severity: Severity;
  /** Detalle estructurado: {renames, extras, missing, metadata}. */
  payload: Record<string, unknown>;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewAction: string | null;
};

/** Entidad nueva o desaparecida detectada por marts.v_entidades_delta. */
export type EntidadDelta = {
  periodoActual: number;
  periodoPrevio: number;
  tipoEntidad: string;
  nombCorreg: string;
  accion: DiffAction;
  /** Si TRUE: el nombre esta en dw.entidad_nombre (rename ya canonizado, no alerta). */
  enMaestra: boolean;
};

/** Una corrida del pipeline (raw.carga_log) para el timeline. */
export type TimelineEntry = {
  id: number;
  stage: StageName | null;
  topico: string | null;
  periodo: number | null;
  status: CargaStatus;
  startedAt: string; // ISO
  finishedAt: string | null;
  durationSeconds: number | null;
  rowsInserted: number;
  triggeredBy: string | null;
  errorMessage: string | null;
};

/** Payload para POST /api/v1/admin/pipeline/anomalias/:id/review */
export type AnomaliaReviewInput = {
  action: "ignored" | "cabecera_updated" | "rename_added" | "falsa_alarma" | "otro";
  notes?: string;
};

/* ──────────────────────────────────────────────────────────────────────── */
/* V2 Data Quality (issue #24)                                               */
/* ──────────────────────────────────────────────────────────────────────── */

export type DataQualityCheckType = "balance_contable" | "outlier_zscore" | "suma_subcuentas";

/** Una fila de admin.data_quality_checks. */
export type QualityCheckRow = {
  id: number;
  periodo: number;
  nombCorreg: string;
  checkType: DataQualityCheckType;
  cuentaCodigo: string | null;
  detectedAt: string; // ISO
  status: Severity;
  expectedValue: number | null;
  actualValue: number | null;
  deltaAbs: number | null;
  deltaPct: number | null;
  zScore: number | null;
  payload: Record<string, unknown>;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewAction: string | null;
};

/** Summary counts por (periodo, check_type). */
export type QualitySummary = {
  periodo: number;
  byCheckType: {
    checkType: DataQualityCheckType;
    critical: number;
    warning: number;
    ok: number;
  }[];
  totalCritical: number;
  totalWarning: number;
};
