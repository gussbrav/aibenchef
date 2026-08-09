/**
 * Query core del Analisis DuPont.
 *
 * Estrategia:
 *   1. Para cada (entidad × periodo del user) calcular TTM inline desde
 *      marts.mv_eeff_resultados_ancho (ytd + dic_prev - same_month_prev).
 *   2. Traer balances promediados desde marts.v_kpis_anuales_entidad
 *      (activos_prom_12m + patrimonio_prom_12m).
 *   3. Aplicar formulas DuPont y devolver una fila plana por entidad+periodo.
 *
 * PERF:
 *   - Pre-filtrar CTEs con lista expandida de aliases raw (mismo patron que
 *     getCuadroResumenRaw). Reduce scan de ~120 entidades a ~10.
 *   - Consumido por getAnalisisDupont, que se cachea en page.tsx con
 *     unstable_cache 30min (mismo patron que /informe).
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { logger } from "@/lib/domains/shared";
import {
  pickColorEstable,
  periodoMismoMesAnioPrev,
  periodoDicAnioPrev,
} from "@/lib/domains/informe/queries";

import type { DupontData, DupontOpts, DupontRow } from "./types";

const log = logger.child("domain.dupont");

// Copia local de safeQuery — informe/queries.ts lo tiene privado. Wraps
// una query con try/catch + log estructurado del error + fallback silent.
// Preferible al try/catch inline porque no ensucia el flow con branches.
async function safeQuery<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const err = e as Error & { code?: string; detail?: string };
    log.error("dupont_query_failed", {
      label,
      message: err.message,
      code: err.code,
      detail: err.detail,
      stack: err.stack?.split("\n").slice(0, 5).join("\n"),
    });
    return fallback;
  }
}

const MESES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatPeriodo(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return `${MESES_ES[mes - 1] ?? "?"}-${String(anio).slice(-2)}`;
}

/**
 * Trae todos los ratios DuPont para 1 solo periodo × N entidades.
 * Consolidar=true: agrupa aliases historicos bajo el canonico actual.
 */
async function getDupontRawForPeriodo(
  periodo: number,
  entidades: string[],
  consolidar: boolean,
): Promise<Map<string, DupontRow>> {
  if (entidades.length === 0) return new Map();

  const dicPrev = periodoDicAnioPrev(periodo);
  const samePrev = periodoMismoMesAnioPrev(periodo);

  const rows = await safeQuery<
    Array<{
      nomb_correg: string;
      roe_pct: number | null;
      roa_pct: number | null;
      apalancamiento: number | null;
      margen_op_pct: number | null;
      otros_ing_pct: number | null;
      impuestos_pct: number | null;
      mfb_pct: number | null;
      isfn_pct: number | null;
      personal_pct: number | null;
      generales_pct: number | null;
      provisiones_pct: number | null;
      ing_cartera_pct: number | null;
      ing_inversion_pct: number | null;
      gastos_fin_pct: number | null;
    }>
  >(
    "getDupontRawForPeriodo",
    async () => {
      const entidadesArr = sql`ARRAY[${sql.join(
        entidades.map((e) => sql`${e}`),
        sql`, `,
      )}]::text[]`;

      const r = await db.execute<{
        nomb_correg: string;
        roe_pct: number | null;
        roa_pct: number | null;
        apalancamiento: number | null;
        margen_op_pct: number | null;
        otros_ing_pct: number | null;
        impuestos_pct: number | null;
        mfb_pct: number | null;
        isfn_pct: number | null;
        personal_pct: number | null;
        generales_pct: number | null;
        provisiones_pct: number | null;
        ing_cartera_pct: number | null;
        ing_inversion_pct: number | null;
        gastos_fin_pct: number | null;
      }>(sql`
        WITH
        -- input: para cada label del user, resolver a su canonico actual.
        -- COALESCE con label como fallback: si resolver_nomb_correg_canonico()
        -- devuelve NULL (label no esta en la maestra), usamos el label directo.
        -- Sin esto, un default incorrecto o typo del usuario dejaria la fila
        -- vacia (todos los ratios NULL) con 0 feedback visible.
        input AS (
          SELECT label,
                 COALESCE(
                   ${consolidar
                     ? sql.raw("dw.resolver_nomb_correg_canonico(label)")
                     : sql.raw(`dw.nombre_vigente_en_periodo(label, ${periodo})`)},
                   label
                 ) AS canon
          FROM unnest(${entidadesArr}) AS t(label)
        ),
        -- raw_names: aliases raw para pre-filtrar MVs. UNION con canon directo
        -- garantiza cobertura cuando el label no esta en entidad_maestra
        -- (fallback path — mejor traer algo del label que 0 filas).
        raw_names AS (
          ${consolidar
            ? sql.raw(`
              SELECT DISTINCT en.nombre AS name
              FROM input i
              JOIN dw.entidad_maestra em ON em.nomb_correg_canonico = i.canon
              JOIN dw.entidad_nombre en  ON en.entidad_id = em.id
              WHERE en.consolidar = TRUE
              UNION
              SELECT canon AS name FROM input WHERE canon IS NOT NULL
              UNION
              SELECT label AS name FROM input WHERE label IS NOT NULL
            `)
            : sql.raw(`SELECT canon AS name FROM input WHERE canon IS NOT NULL`)}
        ),
        -- YTD del mes actual (M del año Y)
        ytd_cur AS (
          SELECT ${consolidar
            ? sql.raw("dw.resolver_nomb_correg_canonico(nomb_correg)")
            : sql.raw(`dw.raw_to_vigente(nomb_correg, ${periodo})`)} AS nomb_correg,
                 SUM(cta_1)    AS cta_1,
                 SUM(cta_1_4)  AS cta_1_4,
                 SUM(cta_2)    AS cta_2,
                 SUM(cta_3)    AS cta_3,
                 SUM(cta_4)    AS cta_4,
                 SUM(cta_6)    AS cta_6,
                 SUM(cta_7)    AS cta_7,
                 SUM(cta_10_1) AS cta_10_1,
                 SUM(COALESCE(cta_10_2,0) + COALESCE(cta_10_3,0) + COALESCE(cta_10_4,0) + COALESCE(cta_12_7,0) + COALESCE(cta_12_8,0)) AS gastos_generales,
                 SUM(cta_11)   AS cta_11,
                 SUM(cta_13)   AS cta_13,
                 SUM(COALESCE(cta_15,0) + COALESCE(cta_16,0)) AS impuestos,
                 SUM(cta_17)   AS cta_17
          FROM marts.mv_eeff_resultados_ancho
          WHERE periodo = ${periodo} AND moneda = 'TOTAL'
            AND nomb_correg IN (SELECT name FROM raw_names)
          GROUP BY 1
        ),
        -- YTD Dic año anterior (Y-1)
        ytd_dic AS (
          SELECT ${consolidar
            ? sql.raw("dw.resolver_nomb_correg_canonico(nomb_correg)")
            : sql.raw(`dw.raw_to_vigente(nomb_correg, ${periodo})`)} AS nomb_correg,
                 SUM(cta_1) AS cta_1, SUM(cta_1_4) AS cta_1_4,
                 SUM(cta_2) AS cta_2, SUM(cta_3) AS cta_3, SUM(cta_4) AS cta_4,
                 SUM(cta_6) AS cta_6, SUM(cta_7) AS cta_7,
                 SUM(cta_10_1) AS cta_10_1,
                 SUM(COALESCE(cta_10_2,0) + COALESCE(cta_10_3,0) + COALESCE(cta_10_4,0) + COALESCE(cta_12_7,0) + COALESCE(cta_12_8,0)) AS gastos_generales,
                 SUM(cta_11) AS cta_11, SUM(cta_13) AS cta_13,
                 SUM(COALESCE(cta_15,0) + COALESCE(cta_16,0)) AS impuestos,
                 SUM(cta_17) AS cta_17
          FROM marts.mv_eeff_resultados_ancho
          WHERE periodo = ${dicPrev} AND moneda = 'TOTAL'
            AND nomb_correg IN (SELECT name FROM raw_names)
          GROUP BY 1
        ),
        -- YTD mismo mes año anterior (M del año Y-1)
        ytd_same AS (
          SELECT ${consolidar
            ? sql.raw("dw.resolver_nomb_correg_canonico(nomb_correg)")
            : sql.raw(`dw.raw_to_vigente(nomb_correg, ${periodo})`)} AS nomb_correg,
                 SUM(cta_1) AS cta_1, SUM(cta_1_4) AS cta_1_4,
                 SUM(cta_2) AS cta_2, SUM(cta_3) AS cta_3, SUM(cta_4) AS cta_4,
                 SUM(cta_6) AS cta_6, SUM(cta_7) AS cta_7,
                 SUM(cta_10_1) AS cta_10_1,
                 SUM(COALESCE(cta_10_2,0) + COALESCE(cta_10_3,0) + COALESCE(cta_10_4,0) + COALESCE(cta_12_7,0) + COALESCE(cta_12_8,0)) AS gastos_generales,
                 SUM(cta_11) AS cta_11, SUM(cta_13) AS cta_13,
                 SUM(COALESCE(cta_15,0) + COALESCE(cta_16,0)) AS impuestos,
                 SUM(cta_17) AS cta_17
          FROM marts.mv_eeff_resultados_ancho
          WHERE periodo = ${samePrev} AND moneda = 'TOTAL'
            AND nomb_correg IN (SELECT name FROM raw_names)
          GROUP BY 1
        ),
        -- TTM = YTD_cur + YTD_dic_prev - YTD_same_prev
        -- Si periodo es Diciembre, YTD_cur == YTD_dic (mismo periodo) — la
        -- resta de ytd_same lo compensa: TTM = ytd_cur (año completo).
        ttm AS (
          SELECT COALESCE(c.nomb_correg, d.nomb_correg, s.nomb_correg) AS nomb_correg,
                 COALESCE(c.cta_1,0)    + COALESCE(d.cta_1,0)    - COALESCE(s.cta_1,0)    AS cta_1_ttm,
                 COALESCE(c.cta_1_4,0)  + COALESCE(d.cta_1_4,0)  - COALESCE(s.cta_1_4,0)  AS cta_1_4_ttm,
                 COALESCE(c.cta_2,0)    + COALESCE(d.cta_2,0)    - COALESCE(s.cta_2,0)    AS cta_2_ttm,
                 COALESCE(c.cta_3,0)    + COALESCE(d.cta_3,0)    - COALESCE(s.cta_3,0)    AS cta_3_ttm,
                 COALESCE(c.cta_4,0)    + COALESCE(d.cta_4,0)    - COALESCE(s.cta_4,0)    AS cta_4_ttm,
                 COALESCE(c.cta_6,0)    + COALESCE(d.cta_6,0)    - COALESCE(s.cta_6,0)    AS cta_6_ttm,
                 COALESCE(c.cta_7,0)    + COALESCE(d.cta_7,0)    - COALESCE(s.cta_7,0)    AS cta_7_ttm,
                 COALESCE(c.cta_10_1,0) + COALESCE(d.cta_10_1,0) - COALESCE(s.cta_10_1,0) AS cta_10_1_ttm,
                 COALESCE(c.gastos_generales,0) + COALESCE(d.gastos_generales,0) - COALESCE(s.gastos_generales,0) AS gastos_generales_ttm,
                 COALESCE(c.cta_11,0)   + COALESCE(d.cta_11,0)   - COALESCE(s.cta_11,0)   AS cta_11_ttm,
                 COALESCE(c.cta_13,0)   + COALESCE(d.cta_13,0)   - COALESCE(s.cta_13,0)   AS cta_13_ttm,
                 COALESCE(c.impuestos,0)+ COALESCE(d.impuestos,0)- COALESCE(s.impuestos,0)AS impuestos_ttm,
                 COALESCE(c.cta_17,0)   + COALESCE(d.cta_17,0)   - COALESCE(s.cta_17,0)   AS cta_17_ttm
          FROM ytd_cur c
          FULL OUTER JOIN ytd_dic  d ON d.nomb_correg = c.nomb_correg
          FULL OUTER JOIN ytd_same s ON s.nomb_correg = c.nomb_correg
        ),
        -- Balances promediados: reusamos v_kpis_anuales_entidad para 12M avgs
        balances AS (
          SELECT nomb_correg, patrimonio_prom_12m, activos_prom_12m
          FROM ${consolidar
            ? sql.raw("marts.v_kpis_anuales_entidad")
            : sql.raw("marts.v_kpis_anuales_historica")}
          WHERE periodo = ${periodo}
            AND nomb_correg IN (SELECT canon FROM input WHERE canon IS NOT NULL)
        )
        -- CONVENCION DE SIGNOS (validada contra el Excel base Analisis DuPont
        -- de Caja Arequipa + funcion marts.compute_kpis_punto_equilibrio):
        --   La data SBS raw devuelve GASTOS como valores POSITIVOS (montos
        --   absolutos). El PDF/Excel Dupont espera gastos NEGATIVOS para
        --   que se sumen algebraicamente con ingresos. Aplicamos negacion
        --   explicita (multiplicar por -1) en gastos.
        --
        --   Ingresos (cta_1, cta_1_4, cta_6, cta_13, cta_17): +
        --   Gastos (cta_2, cta_4, cta_7, cta_10_*, cta_12_*, cta_15+16): +raw, se niegan aca
        --   Subtotales (cta_3=MFB, cta_11=MON): ya vienen netos + en raw
        SELECT
          input.label AS nomb_correg,
          -- Nivel 1 — Rentabilidad
          CASE WHEN b.patrimonio_prom_12m > 0
            THEN ttm.cta_17_ttm / b.patrimonio_prom_12m * 100 END AS roe_pct,
          CASE WHEN b.activos_prom_12m > 0
            THEN ttm.cta_17_ttm / b.activos_prom_12m * 100 END AS roa_pct,
          CASE WHEN b.patrimonio_prom_12m > 0
            THEN b.activos_prom_12m / b.patrimonio_prom_12m END AS apalancamiento,
          -- Nivel 2 — Descomposicion ROA (% activo prom)
          CASE WHEN b.activos_prom_12m > 0
            THEN ttm.cta_11_ttm / b.activos_prom_12m * 100 END AS margen_op_pct,
          CASE WHEN b.activos_prom_12m > 0
            THEN ttm.cta_13_ttm / b.activos_prom_12m * 100 END AS otros_ing_pct,
          CASE WHEN b.activos_prom_12m > 0
            THEN -ttm.impuestos_ttm / b.activos_prom_12m * 100 END AS impuestos_pct,
          -- Nivel 3 — Descomposicion MON (% activo prom)
          CASE WHEN b.activos_prom_12m > 0
            THEN ttm.cta_3_ttm / b.activos_prom_12m * 100 END AS mfb_pct,
          -- ISFN = ingresos servicios financieros - gastos servicios financieros.
          -- cta_6 (ingresos) y cta_7 (gastos) vienen ambos positivos: restar cta_7.
          CASE WHEN b.activos_prom_12m > 0
            THEN (ttm.cta_6_ttm - ttm.cta_7_ttm) / b.activos_prom_12m * 100 END AS isfn_pct,
          CASE WHEN b.activos_prom_12m > 0
            THEN -ttm.cta_10_1_ttm / b.activos_prom_12m * 100 END AS personal_pct,
          CASE WHEN b.activos_prom_12m > 0
            THEN -ttm.gastos_generales_ttm / b.activos_prom_12m * 100 END AS generales_pct,
          CASE WHEN b.activos_prom_12m > 0
            THEN -ttm.cta_4_ttm / b.activos_prom_12m * 100 END AS provisiones_pct,
          -- Nivel 4 — Descomposicion MFB (% activo prom)
          CASE WHEN b.activos_prom_12m > 0
            THEN ttm.cta_1_4_ttm / b.activos_prom_12m * 100 END AS ing_cartera_pct,
          CASE WHEN b.activos_prom_12m > 0
            THEN (ttm.cta_1_ttm - ttm.cta_1_4_ttm) / b.activos_prom_12m * 100 END AS ing_inversion_pct,
          CASE WHEN b.activos_prom_12m > 0
            THEN -ttm.cta_2_ttm / b.activos_prom_12m * 100 END AS gastos_fin_pct
        FROM input
        LEFT JOIN ttm      ON ttm.nomb_correg = input.canon
        LEFT JOIN balances b ON b.nomb_correg = input.canon
      `);
      return [...r];
    },
    [],
  );

  const map = new Map<string, DupontRow>();
  for (const r of rows) {
    map.set(String(r.nomb_correg), {
      entidad: String(r.nomb_correg),
      periodo,
      roePct: r.roe_pct == null ? null : Number(r.roe_pct),
      roaPct: r.roa_pct == null ? null : Number(r.roa_pct),
      apalancamiento: r.apalancamiento == null ? null : Number(r.apalancamiento),
      margenOpPct: r.margen_op_pct == null ? null : Number(r.margen_op_pct),
      otrosIngPct: r.otros_ing_pct == null ? null : Number(r.otros_ing_pct),
      impuestosPct: r.impuestos_pct == null ? null : Number(r.impuestos_pct),
      mfbPct: r.mfb_pct == null ? null : Number(r.mfb_pct),
      isfnPct: r.isfn_pct == null ? null : Number(r.isfn_pct),
      personalPct: r.personal_pct == null ? null : Number(r.personal_pct),
      generalesPct: r.generales_pct == null ? null : Number(r.generales_pct),
      provisionesPct: r.provisiones_pct == null ? null : Number(r.provisiones_pct),
      ingCarteraPct: r.ing_cartera_pct == null ? null : Number(r.ing_cartera_pct),
      ingInversionPct: r.ing_inversion_pct == null ? null : Number(r.ing_inversion_pct),
      gastosFinPct: r.gastos_fin_pct == null ? null : Number(r.gastos_fin_pct),
    });
  }
  return map;
}

/**
 * Analisis DuPont completo — N entidades × M periodos.
 * Corre los periodos en Promise.all (todos son queries independientes).
 */
export async function getAnalisisDupont(opts: DupontOpts): Promise<DupontData> {
  const consolidar = opts.consolidar !== false;

  // Ordenar periodos cronologicamente (mas viejo primero)
  const periodosOrdenados = [...opts.periodos].sort((a, b) => a - b);

  // Colores por entidad — misma paleta que /informe (consistencia visual)
  const usadosColors = new Set<string>();
  const entidadesConColor = opts.entidades.map((nombCorreg) => {
    const overrideColor = opts.colorsOverride?.get(nombCorreg);
    const color = overrideColor ?? pickColorEstable(nombCorreg, usadosColors);
    usadosColors.add(color);
    return {
      nombCorreg,
      labelCorto: nombCorreg,
      color,
    };
  });

  // Fetch en paralelo: 1 query por periodo (~200-500ms cada una)
  const mapas = await Promise.all(
    periodosOrdenados.map((p) => getDupontRawForPeriodo(p, opts.entidades, consolidar)),
  );

  // Aplanar a matriz [entidad × periodo]
  const filas: DupontRow[] = [];
  for (let i = 0; i < periodosOrdenados.length; i++) {
    const periodo = periodosOrdenados[i]!;
    const mapa = mapas[i]!;
    for (const entidad of opts.entidades) {
      const row = mapa.get(entidad);
      if (row) {
        filas.push(row);
      } else {
        // Fallback: fila con nulls para no romper el chart
        filas.push({
          entidad,
          periodo,
          roePct: null,
          roaPct: null,
          apalancamiento: null,
          margenOpPct: null,
          otrosIngPct: null,
          impuestosPct: null,
          mfbPct: null,
          isfnPct: null,
          personalPct: null,
          generalesPct: null,
          provisionesPct: null,
          ingCarteraPct: null,
          ingInversionPct: null,
          gastosFinPct: null,
        });
      }
    }
  }

  return {
    entidades: entidadesConColor,
    periodos: periodosOrdenados.map((codigo) => ({ codigo, label: formatPeriodo(codigo) })),
    filas,
  };
}
