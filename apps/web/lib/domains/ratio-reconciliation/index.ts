/**
 * Ratio Reconciliation domain — QA interno de nuestros ratios calculados
 * vs los publicados oficialmente por SBS.
 *
 * Introducido por V177. Consumido por /dashboard/admin/reconciliacion-sbs.
 *
 * Fuentes:
 *   - gov.ratio_reconciliation             — 1 fila por (periodo, entidad, indicador)
 *   - gov.v_ratio_divergences              — casos con |delta_bps| > 5
 *   - gov.v_ratio_reconciliation_summary   — accuracy % por indicador (12m)
 *   - gov.v_ratio_pending_sbs              — nuestro ratio calculado, SBS aun no publica
 *
 * Poblador: script `pnpm reconcile-ratios` (o llamada directa a la funcion
 * SQL gov.reconcile_ratios(periodo)).
 */

import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";

export type { Indicador, Severidad, DivergenceRow } from "./meta";
export { INDICADOR_LABELS } from "./meta";
import type { Indicador, Severidad, DivergenceRow } from "./meta";

export const INDICADOR_FORMULAS: Record<Indicador, { nuestro: string; sbs: string }> = {
  roa: {
    nuestro: "utilidad_ttm / activos_prom_12m (12 puntos)",
    sbs: "Utilidad Neta Anualizada / Activo Promedio (metodología SBS)",
  },
  roe: {
    nuestro: "utilidad_ttm / patrimonio_prom_12m (12 puntos)",
    sbs: "Utilidad Neta Anualizada / Patrimonio Promedio (metodología SBS)",
  },
  mora_atrasados_directos: {
    nuestro: "cta_a4_3 / (cta_a4_1 + cta_a4_2 + cta_a4_3)",
    sbs: "Créditos Atrasados (criterio SBS) / Créditos Directos",
  },
};

export type AccuracySummaryRow = {
  indicador: Indicador;
  reconciled: number;
  withinTol: number;
  accuracyPct: number | null;
  avgAbsDeltaBps: number | null;
  maxAbsDeltaBps: number | null;
};

export type PendingRow = {
  periodo: number;
  nombCorreg: string;
  indicador: Indicador;
  derivedValue: number;
  daysPending: number;
};

/**
 * Accuracy score de los ultimos 12 periodos, agrupado por indicador.
 * NULL en accuracyPct = sin reconciliaciones aun (SBS no publicado).
 */
export async function getAccuracySummary(): Promise<AccuracySummaryRow[]> {
  const rows = await db.execute<{
    indicador: string;
    reconciled: number;
    within_tol: number;
    accuracy_pct: string | null;
    avg_abs_delta_bps: string | null;
    max_abs_delta_bps: number | null;
  }>(sql`
    SELECT indicador,
           reconciled,
           within_tol,
           accuracy_pct::text  AS accuracy_pct,
           avg_abs_delta_bps::text AS avg_abs_delta_bps,
           max_abs_delta_bps
      FROM gov.v_ratio_reconciliation_summary
     ORDER BY indicador
  `);
  return rows.map((r) => ({
    indicador: r.indicador as Indicador,
    reconciled: Number(r.reconciled),
    withinTol: Number(r.within_tol),
    accuracyPct: r.accuracy_pct !== null ? Number(r.accuracy_pct) : null,
    avgAbsDeltaBps: r.avg_abs_delta_bps !== null ? Number(r.avg_abs_delta_bps) : null,
    maxAbsDeltaBps: r.max_abs_delta_bps !== null ? Number(r.max_abs_delta_bps) : null,
  }));
}

/**
 * Divergencias del ultimo periodo con datos SBS. Ordenadas por severidad
 * (|delta_bps| desc). Devuelve hasta `limit` filas (default 100).
 */
export async function getRecentDivergences(limit = 100): Promise<DivergenceRow[]> {
  const rows = await db.execute<{
    periodo: number;
    nomb_correg: string;
    indicador: string;
    derived_value: string;
    sbs_value: string;
    delta_bps: number;
    abs_delta_bps: number;
    severidad: string;
    sbs_seen_at: string | null;
    last_reconciled_at: string;
    notas: string | null;
    excluida: boolean;
    motivo_exclusion: string | null;
  }>(sql`
    WITH ult AS (
      SELECT MAX(periodo) AS periodo
        FROM gov.v_ratio_divergences
    )
    SELECT v.periodo, v.nomb_correg, v.indicador,
           v.derived_value::text      AS derived_value,
           v.sbs_value::text          AS sbs_value,
           v.delta_bps, v.abs_delta_bps, v.severidad,
           v.sbs_seen_at::text        AS sbs_seen_at,
           v.last_reconciled_at::text AS last_reconciled_at,
           v.notas, v.excluida, v.motivo_exclusion
      FROM gov.v_ratio_divergences v, ult
     WHERE v.periodo = ult.periodo
     ORDER BY v.excluida ASC, v.abs_delta_bps DESC
     LIMIT ${limit}
  `);
  return rows.map((r) => ({
    periodo: Number(r.periodo),
    nombCorreg: r.nomb_correg,
    indicador: r.indicador as Indicador,
    derivedValue: Number(r.derived_value),
    sbsValue: Number(r.sbs_value),
    deltaBps: Number(r.delta_bps),
    absDeltaBps: Number(r.abs_delta_bps),
    severidad: r.severidad as Severidad,
    sbsSeenAt: r.sbs_seen_at,
    lastReconciledAt: r.last_reconciled_at,
    notas: r.notas,
    excluida: Boolean(r.excluida),
    motivoExclusion: r.motivo_exclusion,
  }));
}

/**
 * Ratios calculados por nosotros que aun no tienen valor SBS publicado.
 * Informativo: nada que hacer, solo esperar la publicacion prudencial.
 */
export async function getPendingSbs(limit = 100): Promise<PendingRow[]> {
  const rows = await db.execute<{
    periodo: number;
    nomb_correg: string;
    indicador: string;
    derived_value: string;
    days_pending: number;
  }>(sql`
    SELECT periodo, nomb_correg, indicador,
           derived_value::text AS derived_value,
           days_pending
      FROM gov.v_ratio_pending_sbs
     LIMIT ${limit}
  `);
  return rows.map((r) => ({
    periodo: Number(r.periodo),
    nombCorreg: r.nomb_correg,
    indicador: r.indicador as Indicador,
    derivedValue: Number(r.derived_value),
    daysPending: Number(r.days_pending),
  }));
}

/**
 * Marca o restaura la exclusion de una entidad en TODOS sus periodos e
 * indicadores. Afecta el semaforo de accuracy (excluidas no cuentan) y
 * la severidad en la vista (aparecen como 'excluida' en lugar de 'critico').
 *
 * Cuando excluida=false, motivoExclusion debe ser null.
 * Cuando excluida=true, motivoExclusion es requerido a nivel de app.
 */
export async function markExclusion(
  nombCorreg: string,
  excluida: boolean,
  motivoExclusion: string | null,
): Promise<{ updated: number }> {
  const result = await db.execute<{ n: number }>(sql`
    WITH upd AS (
      UPDATE gov.ratio_reconciliation
         SET excluida         = ${excluida}::boolean,
             motivo_exclusion = ${motivoExclusion}::text
       WHERE nomb_correg = ${nombCorreg}::text
      RETURNING 1
    )
    SELECT COUNT(*)::int AS n FROM upd
  `);
  return { updated: result[0]?.n ?? 0 };
}

/**
 * Conteo rapido para badge del sidebar admin: cuantas divergencias
 * "alto" o "critico" existen sin resolver en el ultimo periodo.
 */
export async function getUnresolvedDivergenceCount(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    WITH ult AS (
      SELECT MAX(periodo) AS periodo FROM gov.v_ratio_divergences
    )
    SELECT COUNT(*)::int AS n
      FROM gov.v_ratio_divergences v, ult
     WHERE v.periodo = ult.periodo
       AND v.severidad IN ('alto', 'critico')
       AND v.notas IS NULL
  `);
  return rows[0]?.n ?? 0;
}
