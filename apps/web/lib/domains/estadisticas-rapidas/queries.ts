import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import type { FilaCOOPAC, FilaSF, PeriodoItem } from "./types";

const MESES_ES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

function labelPeriodo(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return `${MESES_ES[mes - 1] ?? "?"} ${anio}`;
}

/** Periodos disponibles para SF (últimos 24 meses). */
export async function getPeriodosDisponiblesSF(): Promise<PeriodoItem[]> {
  const rows = await db.execute<{ periodo: number }>(sql`
    SELECT DISTINCT periodo
      FROM marts.mv_eeff_ratios
     WHERE moneda = 'TOTAL'
       AND tipo_entidad IN ('BANCOS','FINANCIERAS','CMAC','CRAC','EDPYMES')
     ORDER BY periodo DESC
     LIMIT 24
  `);
  return rows.map((r) => ({
    periodo: Number(r.periodo),
    label: labelPeriodo(Number(r.periodo)),
  }));
}

/**
 * Periodos disponibles para COOPAC.
 * SBS publica EEFF COOPAC con retraso variable por nivel (N1/N2A: trimestral,
 * N2B/N3: mensual). El último periodo es el más reciente donde AL MENOS UN
 * nivel tiene data.
 */
export async function getPeriodosDisponiblesCOOPAC(): Promise<PeriodoItem[]> {
  const rows = await db.execute<{ periodo: number }>(sql`
    SELECT DISTINCT periodo
      FROM marts.mv_eeff_ratios
     WHERE moneda = 'TOTAL'
       AND tipo_entidad IN ('COOPAC_N1','COOPAC_N2A','COOPAC_N2B','COOPAC_N3')
     ORDER BY periodo DESC
     LIMIT 24
  `);
  return rows.map((r) => ({
    periodo: Number(r.periodo),
    label: labelPeriodo(Number(r.periodo)),
  }));
}

/**
 * Estadísticas del Sistema Financiero para un periodo.
 *
 * Fuentes:
 *  - marts.v_indicadores_ancho        → ROE/ROA/mora/cobertura oficial SBS
 *  - marts.mv_cuadro_resumen_historica → cartera_bruta, patrimonio
 *  - marts.v_depositos_total_historica → depositos_total
 *  - marts.v_castigos_12m_historica    → castigos_12m
 *  - marts.v_punto_equilibrio_ancho    → rendimiento, fondeo (TTM)
 *
 * Se excluyen filas donde todos los valores son NULL (entidades sin data
 * en ese periodo).
 */
export async function getEstadisticasSF(periodo: number): Promise<FilaSF[]> {
  // Driver: mv_eeff_ratios (llega antes que indicadores_prudenciales).
  // v_indicadores_ancho se usa como fuente preferida de ROE/ROA/mora/cobertura
  // oficial SBS; si no tiene el periodo aun, cae al valor calculado desde EEFF.
  const rows = await db.execute<{
    nomb_correg: string;
    tipo_entidad: string;
    cartera_bruta: string | null;
    depositos_total: string | null;
    mora_pct: string | null;
    cobertura_pct: string | null;
    castigos_12m: string | null;
    roe_pct: string | null;
    roa_pct: string | null;
    rendimiento_pct: string | null;
    fondeo_pct: string | null;
  }>(sql`
    SELECT
      er.nomb_correg,
      er.tipo_entidad,
      er.cartera_bruta::text                                           AS cartera_bruta,
      dep.depositos_total::text                                        AS depositos_total,
      COALESCE(ind.mora_atrasados_sobre_directos, er.ratio_mora)::text AS mora_pct,
      COALESCE(ind.provisiones_sobre_atrasados,
               er.ratio_cobertura_atrasados)::text                    AS cobertura_pct,
      cas.castigos_12m::text                                           AS castigos_12m,
      COALESCE(ind.roe_sbs, er.roe)::text                             AS roe_pct,
      COALESCE(ind.roa_sbs, er.roa)::text                             AS roa_pct,
      pe.pct_rendimiento::text                                         AS rendimiento_pct,
      pe.pct_costo_fondeo::text                                        AS fondeo_pct
    FROM marts.mv_eeff_ratios er
    LEFT JOIN marts.v_indicadores_ancho ind
           ON ind.periodo     = er.periodo
          AND ind.nomb_correg  = er.nomb_correg
    LEFT JOIN marts.v_depositos_total_historica dep
           ON dep.periodo     = er.periodo
          AND dep.nomb_correg  = er.nomb_correg
    LEFT JOIN marts.v_castigos_12m_historica cas
           ON cas.periodo     = er.periodo
          AND cas.nomb_correg  = er.nomb_correg
    LEFT JOIN marts.v_punto_equilibrio_ancho pe
           ON pe.periodo      = er.periodo
          AND pe.nomb_correg   = er.nomb_correg
          AND pe.moneda        = 'TOTAL'
    WHERE er.periodo    = ${periodo}
      AND er.moneda     = 'TOTAL'
      AND er.tipo_entidad IN ('BANCOS','FINANCIERAS','CMAC','CRAC','EDPYMES')
    ORDER BY er.tipo_entidad, er.cartera_bruta DESC NULLS LAST
  `);

  return rows
    .filter((r) =>
      r.cartera_bruta != null ||
      r.roe_pct != null ||
      r.mora_pct != null
    )
    .map((r) => ({
      nomb_correg: r.nomb_correg,
      tipo_entidad: r.tipo_entidad as FilaSF["tipo_entidad"],
      cartera_bruta: r.cartera_bruta != null ? Number(r.cartera_bruta) : null,
      depositos_total: r.depositos_total != null ? Number(r.depositos_total) : null,
      mora_pct: r.mora_pct != null ? Number(r.mora_pct) : null,
      cobertura_pct: r.cobertura_pct != null ? Number(r.cobertura_pct) : null,
      castigos_12m: r.castigos_12m != null ? Number(r.castigos_12m) : null,
      roe_pct: r.roe_pct != null ? Number(r.roe_pct) : null,
      roa_pct: r.roa_pct != null ? Number(r.roa_pct) : null,
      rendimiento_pct: r.rendimiento_pct != null ? Number(r.rendimiento_pct) : null,
      fondeo_pct: r.fondeo_pct != null ? Number(r.fondeo_pct) : null,
    }));
}

/**
 * Estadísticas COOPAC para un periodo.
 *
 * Fuente: marts.mv_eeff_ratios (TOTAL moneda) + marts.v_punto_equilibrio_ancho.
 * Los ratios mora/cobertura/ROE/ROA se calculan desde EEFF (no desde
 * indicadores_prudenciales, que no cubre cooperativas).
 */
export async function getEstadisticasCOOPAC(periodo: number): Promise<FilaCOOPAC[]> {
  const rows = await db.execute<{
    nomb_correg: string;
    tipo_entidad: string;
    cartera_bruta: string | null;
    depositos_sbs: string | null;
    total_activo: string | null;
    patrimonio: string | null;
    utilidad_neta: string | null;
    mora_pct: string | null;
    cobertura_pct: string | null;
    roe: string | null;
    roa: string | null;
  }>(sql`
    SELECT
      er.nomb_correg,
      er.tipo_entidad,
      er.cartera_bruta::text        AS cartera_bruta,
      er.depositos_sbs::text        AS depositos_sbs,
      er.total_activo::text         AS total_activo,
      er.patrimonio::text           AS patrimonio,
      er.utilidad_neta::text        AS utilidad_neta,
      er.ratio_mora::text           AS mora_pct,
      er.ratio_cobertura_atrasados::text AS cobertura_pct,
      er.roe::text                  AS roe,
      er.roa::text                  AS roa
    FROM marts.mv_eeff_ratios er
    WHERE er.periodo     = ${periodo}
      AND er.moneda      = 'TOTAL'
      AND er.tipo_entidad IN ('COOPAC_N1','COOPAC_N2A','COOPAC_N2B','COOPAC_N3')
    ORDER BY er.tipo_entidad, er.cartera_bruta DESC NULLS LAST
  `);

  return rows
    .filter((r) => r.cartera_bruta != null || r.total_activo != null)
    .map((r) => ({
      nomb_correg: r.nomb_correg,
      tipo_entidad: r.tipo_entidad as FilaCOOPAC["tipo_entidad"],
      cartera_bruta: r.cartera_bruta != null ? Number(r.cartera_bruta) : null,
      depositos_sbs: r.depositos_sbs != null ? Number(r.depositos_sbs) : null,
      total_activo: r.total_activo != null ? Number(r.total_activo) : null,
      patrimonio: r.patrimonio != null ? Number(r.patrimonio) : null,
      utilidad_neta: r.utilidad_neta != null ? Number(r.utilidad_neta) : null,
      mora_pct: r.mora_pct != null ? Number(r.mora_pct) : null,
      cobertura_pct: r.cobertura_pct != null ? Number(r.cobertura_pct) : null,
      roe: r.roe != null ? Number(r.roe) : null,
      roa: r.roa != null ? Number(r.roa) : null,
    }));
}
