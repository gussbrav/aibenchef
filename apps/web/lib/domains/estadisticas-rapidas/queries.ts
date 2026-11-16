import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import type {
  EjeMetrica,
  FilaCOOPAC,
  FilaSF,
  NivelCOOPAC,
  PeriodoItem,
  SubsistemasSF,
  TrayectoriaEntidad,
} from "./types";

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
    periodo: number;
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
      er.periodo,
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
    .filter((r) => r.cartera_bruta != null || r.roe_pct != null || r.mora_pct != null)
    .map((r) => ({
      periodo: Number(r.periodo),
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
 * Estadísticas COOPAC usando el ÚLTIMO periodo disponible por nivel ≤ periodoMax.
 *
 * SBS publica EEFF COOPAC con retraso variable por nivel (N1/N2A: trimestral,
 * N2B/N3: mensual). En lugar de filtrar por periodo exacto (que deja niveles
 * vacíos), cada nivel trae su propio último dato disponible hasta periodoMax.
 *
 * El campo `periodo` en cada fila indica de cuándo es el dato.
 */
export async function getEstadisticasCOOPAC(periodoMax: number): Promise<FilaCOOPAC[]> {
  const rows = await db.execute<{
    periodo: number;
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
    WITH ultimo_por_nivel AS (
      SELECT tipo_entidad, MAX(periodo) AS ultimo_periodo
        FROM marts.mv_eeff_ratios
       WHERE moneda      = 'TOTAL'
         AND tipo_entidad IN ('COOPAC_N1','COOPAC_N2A','COOPAC_N2B','COOPAC_N3')
         AND periodo     <= ${periodoMax}
       GROUP BY tipo_entidad
    )
    SELECT
      er.periodo,
      er.nomb_correg,
      er.tipo_entidad,
      er.cartera_bruta::text             AS cartera_bruta,
      er.depositos_sbs::text             AS depositos_sbs,
      er.total_activo::text              AS total_activo,
      er.patrimonio::text                AS patrimonio,
      er.utilidad_neta::text             AS utilidad_neta,
      er.ratio_mora::text                AS mora_pct,
      er.ratio_cobertura_atrasados::text AS cobertura_pct,
      er.roe::text                       AS roe,
      er.roa::text                       AS roa
    FROM marts.mv_eeff_ratios er
    INNER JOIN ultimo_por_nivel u
            ON u.tipo_entidad   = er.tipo_entidad
           AND u.ultimo_periodo = er.periodo
    WHERE er.moneda = 'TOTAL'
    ORDER BY er.tipo_entidad, er.cartera_bruta DESC NULLS LAST
  `);

  return rows
    .filter((r) => r.cartera_bruta != null || r.total_activo != null)
    .map((r) => ({
      periodo: Number(r.periodo),
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

// ============================================================================
// Matriz de Trayectoria — posición actual + desplazamiento vs ventana previa
// ============================================================================

/**
 * Mapeo de métricas → columnas SQL en marts.mv_eeff_ratios.
 * Todas las columnas vienen como decimales 0-1 (ej: 0.0963 = 9.63%).
 */
const COLUMNA_METRICA: Record<EjeMetrica, string> = {
  roe: "roe",
  roa: "roa",
  mora: "ratio_mora",
  cobertura: "ratio_cobertura_atrasados",
};

/**
 * Trayectoria de entidades en la matriz 2D (ejeX, ejeY) con comparación al
 * periodo _ventanaMeses_ atrás. Se usa para visualización tipo scatter con
 * flechas que muestran "de dónde vino cada entidad".
 *
 * Estrategia de periodo previo:
 *   Intentamos (periodo - ventanaMeses) como mes calendario. Si la entidad no
 *   tuvo reporte en ese periodo exacto (COOPAC trimestrales se saltan), caemos
 *   al reporte más cercano ANTERIOR o igual a esa fecha, dentro del año móvil.
 *
 * Entidades sin x_actual o y_actual se excluyen (no tienen posición en el plano).
 * Entidades sin medición previa salen con x_prev = y_prev = null → render sin flecha.
 */
export async function getTrayectoria(opts: {
  tipoEntidad: NivelCOOPAC | SubsistemasSF;
  /**
   * Periodo límite superior. El query usa el ÚLTIMO periodo disponible ≤
   * periodoActual para el tipo_entidad (COOPAC N1/N2A trimestrales, N3 anual,
   * SF mensual — frecuencias heterogéneas). Esto evita que el usuario vea
   * "sin datos" por elegir un mes donde ese nivel no reporta.
   */
  periodoActual: number;
  ejeX: EjeMetrica;
  ejeY: EjeMetrica;
  ventanaMeses?: number; // default 12
}): Promise<TrayectoriaEntidad[]> {
  const ventana = opts.ventanaMeses ?? 12;
  const colX = COLUMNA_METRICA[opts.ejeX];
  const colY = COLUMNA_METRICA[opts.ejeY];

  const rows = await db.execute<{
    nomb_correg: string;
    tipo_entidad: string;
    x_actual: string | null;
    y_actual: string | null;
    x_prev: string | null;
    y_prev: string | null;
    peso: string | null;
    periodo_actual: number;
    periodo_prev: number | null;
  }>(sql`
    WITH ultimo AS (
      -- Último periodo disponible ≤ periodoActual para este tipo_entidad.
      -- Maneja COOPAC con frecuencia heterogénea sin requerir que el usuario
      -- sepa cuándo reportó cada nivel.
      SELECT MAX(periodo) AS periodo_efectivo
        FROM marts.mv_eeff_ratios
       WHERE moneda       = 'TOTAL'
         AND tipo_entidad = ${opts.tipoEntidad}
         AND periodo     <= ${opts.periodoActual}
         AND ${sql.raw(colX)} IS NOT NULL
         AND ${sql.raw(colY)} IS NOT NULL
    ),
    actual AS (
      SELECT r.nomb_correg,
             r.tipo_entidad,
             ${sql.raw(`r.${colX}`)}::numeric AS x_actual,
             ${sql.raw(`r.${colY}`)}::numeric AS y_actual,
             r.patrimonio::numeric            AS peso,
             r.periodo                        AS periodo_actual
        FROM marts.mv_eeff_ratios r
        CROSS JOIN ultimo u
       WHERE r.moneda       = 'TOTAL'
         AND r.tipo_entidad = ${opts.tipoEntidad}
         AND r.periodo      = u.periodo_efectivo
         AND ${sql.raw(`r.${colX}`)} IS NOT NULL
         AND ${sql.raw(`r.${colY}`)} IS NOT NULL
    ),
    -- Periodo nominal previo = periodo_efectivo menos (ventanaMeses) calendario.
    prev_target AS (
      SELECT
        (CASE
          WHEN ((u.periodo_efectivo / 100) * 12 + (u.periodo_efectivo % 100) - 1 - ${ventana}) / 12
               >= 0
          THEN ((((u.periodo_efectivo / 100) * 12 + (u.periodo_efectivo % 100) - 1 - ${ventana}) / 12) * 100
                + (((u.periodo_efectivo / 100) * 12 + (u.periodo_efectivo % 100) - 1 - ${ventana}) % 12) + 1)
        END)                                AS periodo_prev_nominal,
        u.periodo_efectivo                  AS periodo_efectivo
      FROM ultimo u
    ),
    -- Para cada entidad, el periodo más cercano al prev_nominal, SIEMPRE
    -- anterior al actual y dentro de una ventana razonable (12m hacia atrás
    -- del nominal, para cubrir reporters anuales que puedan tener data más vieja).
    prev_candidatos AS (
      SELECT a.nomb_correg,
             r.periodo,
             ${sql.raw(`r.${colX}`)}::numeric AS x_prev,
             ${sql.raw(`r.${colY}`)}::numeric AS y_prev,
             ROW_NUMBER() OVER (
               PARTITION BY a.nomb_correg
               ORDER BY ABS(r.periodo - (SELECT periodo_prev_nominal FROM prev_target)) ASC
             ) AS rn
        FROM actual a
        JOIN marts.mv_eeff_ratios r
          ON r.nomb_correg  = a.nomb_correg
         AND r.moneda       = 'TOTAL'
         AND r.tipo_entidad = a.tipo_entidad
         AND r.periodo      < a.periodo_actual
         AND r.periodo      >= a.periodo_actual - 200 -- hasta 2 años atrás
         AND ${sql.raw(`r.${colX}`)} IS NOT NULL
         AND ${sql.raw(`r.${colY}`)} IS NOT NULL
    ),
    prev AS (
      SELECT nomb_correg, periodo, x_prev, y_prev
        FROM prev_candidatos
       WHERE rn = 1
    )
    SELECT a.nomb_correg,
           a.tipo_entidad,
           a.x_actual::text       AS x_actual,
           a.y_actual::text       AS y_actual,
           p.x_prev::text         AS x_prev,
           p.y_prev::text         AS y_prev,
           a.peso::text           AS peso,
           a.periodo_actual,
           p.periodo              AS periodo_prev
      FROM actual a
      LEFT JOIN prev p USING (nomb_correg)
      ORDER BY a.peso DESC NULLS LAST
  `);

  return rows.map((r) => ({
    nomb_correg: r.nomb_correg,
    tipo_entidad: r.tipo_entidad as NivelCOOPAC | SubsistemasSF,
    x_actual: Number(r.x_actual),
    y_actual: Number(r.y_actual),
    x_prev: r.x_prev != null ? Number(r.x_prev) : null,
    y_prev: r.y_prev != null ? Number(r.y_prev) : null,
    peso: r.peso != null ? Number(r.peso) : null,
    periodo_actual: Number(r.periodo_actual),
    periodo_prev: r.periodo_prev != null ? Number(r.periodo_prev) : null,
  }));
}
