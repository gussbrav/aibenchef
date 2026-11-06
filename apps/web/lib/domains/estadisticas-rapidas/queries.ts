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

/**
 * Periodos disponibles para el selector.
 * Prioriza diciembre (cierres anuales). Devuelve últimos 24 meses únicos
 * presentes en ambos sistemas, ordenados desc.
 */
export async function getPeriodosDisponibles(): Promise<PeriodoItem[]> {
  const rows = await db.execute<{ periodo: number }>(sql`
    SELECT DISTINCT periodo
      FROM marts.mv_eeff_ratios
     WHERE moneda = 'TOTAL'
       AND tipo_entidad IN (
         'BANCOS','FINANCIERAS','CMAC','CRAC','EDPYMES',
         'COOPAC_N1','COOPAC_N2A','COOPAC_N2B','COOPAC_N3'
       )
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
      ind.nomb_correg,
      ind.tipo_entidad,
      res.cartera_bruta::text                      AS cartera_bruta,
      dep.depositos_total::text                    AS depositos_total,
      ind.mora_atrasados_sobre_directos::text      AS mora_pct,
      ind.provisiones_sobre_atrasados::text        AS cobertura_pct,
      cas.castigos_12m::text                       AS castigos_12m,
      ind.roe_sbs::text                            AS roe_pct,
      ind.roa_sbs::text                            AS roa_pct,
      pe.pct_rendimiento::text                     AS rendimiento_pct,
      pe.pct_costo_fondeo::text                    AS fondeo_pct
    FROM marts.v_indicadores_ancho ind
    LEFT JOIN marts.mv_cuadro_resumen_historica res
           ON res.periodo    = ind.periodo
          AND res.nomb_correg = ind.nomb_correg
    LEFT JOIN marts.v_depositos_total_historica dep
           ON dep.periodo    = ind.periodo
          AND dep.nomb_correg = ind.nomb_correg
    LEFT JOIN marts.v_castigos_12m_historica cas
           ON cas.periodo    = ind.periodo
          AND cas.nomb_correg = ind.nomb_correg
    LEFT JOIN marts.v_punto_equilibrio_ancho pe
           ON pe.periodo     = ind.periodo
          AND pe.nomb_correg  = ind.nomb_correg
          AND pe.moneda       = 'TOTAL'
    WHERE ind.periodo = ${periodo}
      AND ind.tipo_entidad IN ('BANCOS','FINANCIERAS','CMAC','CRAC','EDPYMES')
    ORDER BY ind.tipo_entidad, res.cartera_bruta DESC NULLS LAST
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
