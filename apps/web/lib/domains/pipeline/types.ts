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

/* ──────────────────────────────────────────────────────────────────────── */
/* EEFF Inspector (issue #26)                                                */
/* ──────────────────────────────────────────────────────────────────────── */

export type Moneda = "MN" | "ME" | "TOTAL";
export type TipoEstado = "balance" | "resultados";

/**
 * Una fila del inspector — driver es dw.cabecera_maestra (las cabeceras-base
 * que definio el operador), con valores LEFT JOIN desde raw.eeff_observacion.
 *
 * Cada fila muestra los 3 valores monetarios simultaneamente (MN/ME/TOTAL)
 * para replicar exactamente la vista del archivo SBS original. Delta vs
 * periodo previo se computa sobre el TOTAL.
 *
 * Si nombreArchivo es NULL: la cabecera espera esta fila pero el parser NO la
 * persistio.
 */
export type EeffRow = {
  /** Orden visual segun la cabecera-base (1, 2, 3, ...). */
  orden: number;
  /** Codigo contable (A1, A1.1, ...). NULL si la cabecera lista la fila sin codigo. */
  cuentaCodigo: string | null;
  /** Nombre canonico segun dw.cabecera_maestra (la verdad-base del operador). */
  cuentaNombreCanonica: string;
  /** Nombre tal cual viene del archivo SBS (puede diferir). NULL si no hay match. */
  cuentaNombreArchivo: string | null;
  /** True si nombreArchivo difiere del canonico (warning, posible drift SBS). */
  nombreMismatch: boolean;
  /** True si la cabecera espera valor pero no esta en raw.eeff_observacion. */
  faltaEnRaw: boolean;

  /** Valor en Moneda Nacional (S/). */
  valorMN: number | null;
  /** Valor en Moneda Extranjera (USD equivalente en miles). */
  valorME: number | null;
  /** Valor consolidado (MN + ME convertido a soles). */
  valorTotal: number | null;

  /** Valor TOTAL del periodo anterior — para delta. */
  valorPrev: number | null;
  /** Δ% sobre TOTAL vs periodo anterior. NULL si no hay valor previo o = 0. */
  deltaPct: number | null;
  /** Δ absoluto sobre TOTAL vs periodo anterior. */
  deltaAbs: number | null;
  /** Indica si esta cuenta tiene quality_checks con status critical/warning. */
  qualityStatus: "ok" | "warning" | "critical";

  /** Flags de renderizado segun dw.cabecera_maestra. */
  nivel: number;
  esHeader: boolean;
  esTotal: boolean;
  esSeccion: boolean;
};

/** Response del endpoint /api/v1/admin/pipeline/eeff.
 *
 * No incluye campo `moneda` — devuelve siempre las 3 (MN/ME/TOTAL)
 * en cada fila para que el operador valide simultaneamente como en el
 * archivo SBS original.
 */
export type EeffInspectorData = {
  entidad: string;
  periodo: number;
  periodoPrevio: number | null;
  tipoEntidad: string | null;
  balance: EeffRow[];
  resultados: EeffRow[];
  /** Filas en raw.eeff_observacion que NO estan en la cabecera-base (drift SBS). */
  extrasBalance: {
    cuentaCodigo: string;
    cuentaNombre: string;
    valorMN: number | null;
    valorME: number | null;
    valorTotal: number | null;
  }[];
  extrasResultados: {
    cuentaCodigo: string;
    cuentaNombre: string;
    valorMN: number | null;
    valorME: number | null;
    valorTotal: number | null;
  }[];
  qualitySummary: {
    balance: { critical: number; warning: number; ok: number };
    outliers: { critical: number; warning: number; ok: number };
    subcuentas: { critical: number; warning: number; ok: number };
  };
  archivos: { topico: string; pathLocal: string; sourceUrl: string }[];
};

/** Items del dropdown de entidades disponibles para un periodo. */
export type EntidadOption = {
  nombCorreg: string;
  tipoEntidad: string;
};

/* ──────────────────────────────────────────────────────────────────────── */
/* Cabecera Aligner (issue #28)                                              */
/* ──────────────────────────────────────────────────────────────────────── */

export type CabeceraDiffStatus = "in_cabecera" | "missing_in_cabecera";

export type CabeceraDiffRow = {
  tipoEstado: TipoEstado;
  tipoEntidad: string;
  periodo: number;
  cuentaCodigo: string;
  cuentaNombreRaw: string | null;
  nEntidades: number;
  cuentaNombreCanonica: string | null;
  ordenCabecera: number | null;
  nivelCabecera: number | null;
  status: CabeceraDiffStatus;
};

export type CabeceraAlignInput = {
  tipoEstado: TipoEstado;
  tipoEntidad: string;
  codigos: string[];
  periodoSrc: number;
  motivo?: string;
};
