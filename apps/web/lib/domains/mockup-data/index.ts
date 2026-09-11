/**
 * Dominio mockup-data — provee los KPIs reales para el Cuadro Resumen
 * del landing publico. Porta la logica de scripts/regen-hero-mockup.ts
 * para que el landing los obtenga directamente de la DB en cada render
 * ISR (revalidate = 86400), sin script manual.
 *
 * Fallback: si la DB falla o devuelve datos invalidos, retorna el JSON
 * estatico pre-bakeado (ultimo periodo conocido bueno). El landing
 * nunca queda en blanco.
 */

import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import rawFallback from "@/components/marketing/dashboard-mockup-data.json";

// ============================================================================
// Types
// ============================================================================

export type MockupFila = {
  label: string;
  seccion: "cartera" | "calidad" | "rentabilidad";
  valores: number[];
  format: "moneda_mm" | "pct" | "moneda_mm_utilidad";
  signo: 1 | -1;
};

export type MockupData = {
  generatedAt: string;
  periodo: number;
  periodoLabel: string;
  grupoSbs: string;
  propiaIdx: number;
  entidades: string[];
  filas: MockupFila[];
};

const STATIC_FALLBACK = rawFallback as MockupData;

// ============================================================================
// Helpers
// ============================================================================

const MESES: Record<number, string> = {
  1: "Ene", 2: "Feb", 3: "Mar", 4: "Abr", 5: "May",  6: "Jun",
  7: "Jul", 8: "Ago", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dic",
};

function periodoLabel(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes  = periodo % 100;
  return `${MESES[mes] ?? String(mes)} ${anio}`;
}

// Retorna el primer periodo de la ventana TTM (12 meses) que termina en
// `periodo`. Ej: 202607 → 202508 (12 meses: ago-25 a jul-26).
function ttmDesde(periodo: number): number {
  const anio = Math.floor(periodo / 100);
  const mes  = periodo % 100;
  // Retroceder 11 meses
  const mesDesde = mes - 11;
  if (mesDesde > 0) return anio * 100 + mesDesde;
  return (anio - 1) * 100 + (mesDesde + 12);
}

function toMM(n: unknown): number {
  const v = Number(n);
  return isNaN(v) ? 0 : Math.round(v / 1_000_000);
}

function toPct(n: unknown): number {
  const v = Number(n);
  if (isNaN(v)) return 0;
  // Valores que llegan como decimal (0.0273 = 2.73%) vs porcentaje (127.94)
  // Heuristica: si abs <= 2 → decimal → multiplicar x100
  return Number((Math.abs(v) <= 2 ? v * 100 : v).toFixed(2));
}

// ============================================================================
// Fetch
// ============================================================================

export async function fetchMockupData(): Promise<MockupData> {
  try {
    // 1. Periodo mas reciente con datos de balance
    const [{ periodo }] = await db.execute<{ periodo: number }>(sql`
      SELECT MAX(periodo)::int AS periodo
        FROM marts.v_eeff_balance_ancho
    `);
    if (!periodo) return STATIC_FALLBACK;

    // 2. Top 5 bancos por cartera bruta (peer group del hero)
    const bancos = await db.execute<{ nomb_correg: string }>(sql`
      SELECT b.nomb_correg
        FROM marts.v_eeff_balance_ancho b
       WHERE b.periodo      = ${periodo}
         AND b.moneda       = 'TOTAL'
         AND b.tipo_entidad = 'BANCOS'
         AND EXISTS (
           SELECT 1 FROM marts.v_mora_global_historica m
            WHERE m.periodo = ${periodo} AND m.nomb_correg = b.nomb_correg
         )
       ORDER BY COALESCE(b.cta_a4_1, 0) + COALESCE(b.cta_a4_2, 0) + COALESCE(b.cta_a4_3, 0) DESC
       LIMIT 5
    `);
    const entidades = bancos.map((r) => r.nomb_correg);
    if (entidades.length === 0) return STATIC_FALLBACK;

    const periodoAnterior = (Math.floor(periodo / 100) - 1) * 100 + (periodo % 100);
    const periodoTtmDesde = ttmDesde(periodo);

    // 3. KPIs en una sola query multi-CTE (mismo SQL que regen-hero-mockup.ts)
    type KpiRow = {
      nomb_correg: string;
      cartera:      string | null;
      cartera_prev: string | null;
      atrasada:     string | null;
      patrimonio:   string | null;
      activos:      string | null;
      utilidad_ttm: string | null;
      mora_global:  string | null;
      cobertura_car: string | null;
    };

    const kpis = await db.execute<KpiRow>(sql`
      WITH bg_act AS (
        SELECT nomb_correg,
               COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0) AS cartera,
               COALESCE(cta_a4_3, 0) AS atrasada,
               cta_c                  AS patrimonio,
               cta_a                  AS activos
          FROM marts.v_eeff_balance_ancho
         WHERE periodo = ${periodo}
           AND moneda  = 'TOTAL'
           AND nomb_correg = ANY(${entidades}::text[])
      ),
      bg_prev AS (
        SELECT nomb_correg,
               COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0) AS cartera_prev
          FROM marts.v_eeff_balance_ancho
         WHERE periodo = ${periodoAnterior}
           AND moneda  = 'TOTAL'
           AND nomb_correg = ANY(${entidades}::text[])
      ),
      er_ttm AS (
        SELECT nomb_correg, SUM(cta_17) AS utilidad_ttm
          FROM marts.v_eeff_resultados_ancho
         WHERE periodo BETWEEN ${periodoTtmDesde} AND ${periodo}
           AND moneda  = 'TOTAL'
           AND nomb_correg = ANY(${entidades}::text[])
         GROUP BY nomb_correg
      ),
      mora AS (
        SELECT nomb_correg, pct_mora_global AS mora_global
          FROM marts.v_mora_global_historica
         WHERE periodo     = ${periodo}
           AND nomb_correg = ANY(${entidades}::text[])
      ),
      car AS (
        SELECT nomb_correg, pct_cobertura_car AS cobertura_car
          FROM marts.v_cobertura_car_historica
         WHERE periodo     = ${periodo}
           AND nomb_correg = ANY(${entidades}::text[])
      )
      SELECT a.nomb_correg,
             a.cartera::text, p.cartera_prev::text, a.atrasada::text,
             a.patrimonio::text, a.activos::text,
             e.utilidad_ttm::text,
             m.mora_global::text, c.cobertura_car::text
        FROM bg_act a
        LEFT JOIN bg_prev p USING (nomb_correg)
        LEFT JOIN er_ttm  e USING (nomb_correg)
        LEFT JOIN mora    m USING (nomb_correg)
        LEFT JOIN car     c USING (nomb_correg)
    `);

    if (kpis.length === 0) return STATIC_FALLBACK;

    const byEnt = new Map(kpis.map((r) => [r.nomb_correg, r]));

    const get = (e: string, fn: (r: KpiRow) => number): number => {
      const r = byEnt.get(e);
      return r ? fn(r) : 0;
    };

    const filas: MockupFila[] = [
      {
        label:   "Cartera Bruta (MM S/)",
        seccion: "cartera",
        format:  "moneda_mm",
        signo:   1,
        valores: entidades.map((e) => get(e, (r) => toMM(r.cartera))),
      },
      {
        label:   "Crec. Cartera YoY",
        seccion: "cartera",
        format:  "pct",
        signo:   1,
        valores: entidades.map((e) => get(e, (r) => {
          const c = Number(r.cartera), cp = Number(r.cartera_prev);
          if (!cp || cp === 0) return 0;
          return Number((((c - cp) / cp) * 100).toFixed(2));
        })),
      },
      {
        label:   "% Créditos Atrasados",
        seccion: "calidad",
        format:  "pct",
        signo:   -1,
        valores: entidades.map((e) => get(e, (r) => {
          const c = Number(r.cartera);
          if (!c || c === 0) return 0;
          return Number(((Number(r.atrasada) / c) * 100).toFixed(2));
        })),
      },
      {
        label:   "% Mora Global (sin V/C)",
        seccion: "calidad",
        format:  "pct",
        signo:   -1,
        valores: entidades.map((e) => get(e, (r) => toPct(r.mora_global))),
      },
      {
        label:   "Cobertura CAR (%)",
        seccion: "calidad",
        format:  "pct",
        signo:   1,
        valores: entidades.map((e) => get(e, (r) => toPct(r.cobertura_car))),
      },
      {
        label:   "Utilidad Neta (MM S/)",
        seccion: "rentabilidad",
        format:  "moneda_mm_utilidad",
        signo:   1,
        valores: entidades.map((e) => get(e, (r) => toMM(r.utilidad_ttm))),
      },
      {
        label:   "% ROE",
        seccion: "rentabilidad",
        format:  "pct",
        signo:   1,
        valores: entidades.map((e) => get(e, (r) => {
          const p = Number(r.patrimonio);
          if (!p || p === 0) return 0;
          return Number(((Number(r.utilidad_ttm) / p) * 100).toFixed(2));
        })),
      },
      {
        label:   "% ROA",
        seccion: "rentabilidad",
        format:  "pct",
        signo:   1,
        valores: entidades.map((e) => get(e, (r) => {
          const a = Number(r.activos);
          if (!a || a === 0) return 0;
          return Number(((Number(r.utilidad_ttm) / a) * 100).toFixed(2));
        })),
      },
    ];

    // Validar: al menos la cartera bruta tiene datos reales
    const carteraFila = filas.find((f) => f.label === "Cartera Bruta (MM S/)");
    const valid = carteraFila?.valores.some((v) => v !== 0) ?? false;
    if (!valid) return STATIC_FALLBACK;

    return {
      generatedAt:  new Date().toISOString(),
      periodo,
      periodoLabel: periodoLabel(periodo),
      grupoSbs:     "Banca Múltiple",
      propiaIdx:    0,
      entidades,
      filas,
    };
  } catch (err) {
    console.error("[fetchMockupData] error — usando fallback JSON:", err);
    return STATIC_FALLBACK;
  }
}
