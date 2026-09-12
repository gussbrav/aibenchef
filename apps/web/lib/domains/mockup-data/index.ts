/**
 * Dominio mockup-data — provee los KPIs reales para el Cuadro Resumen
 * del landing publico.
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

function ttmDesde(periodo: number): number {
  const anio = Math.floor(periodo / 100);
  const mes  = periodo % 100;
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
  return Number((Math.abs(v) <= 2 ? v * 100 : v).toFixed(2));
}

// Nombres cortos para la UI del landing (los nombres en DB son largos)
const ABREV_BANCO: Record<string, string> = {
  "Banco de Crédito del Perú":         "BCP",
  "Banco BBVA Perú":                   "BBVA",
  "Interbank":                         "Interbank",
  "Scotiabank Perú":                   "Scotiabank",
  "Banco Interamericano de Finanzas":  "BanBif",
  "Mibanco":                           "Mibanco",
  "Banco GNB Perú":                    "GNB",
  "Banco Falabella Perú":              "Falabella",
  "Banco Ripley Perú":                 "Ripley",
  "Banco Santander Perú":              "Santander",
  "Banco de Comercio":                 "B. Comercio",
  "Banco Azteca del Perú":             "Azteca",
  "Citibank del Perú":                 "Citibank",
  "ICBC Peru Bank":                    "ICBC",
  "Bank of China":                     "Bank of China",
  "Banco de la Nación":                "Nación",
};

function abrevEntidad(nombre: string): string {
  return (
    ABREV_BANCO[nombre] ??
    nombre
      .replace(/^Banco\s+/i, "")
      .replace(/\s+del?\s+Per[uú]$/i, "")
      .replace(/\s+Per[uú]$/i, "")
      .trim()
  );
}

// Construye un fragmento SQL IN ($1, $2, ...) compatible con drizzle + postgres.js.
// Usar ANY(${array}::text[]) lanza "cannot cast type record to text[]".
function inList(values: string[]) {
  return sql.join(values.map((v) => sql`${v}`), sql`, `);
}

// ============================================================================
// Fetch
// ============================================================================

export async function fetchMockupData(): Promise<MockupData> {
  try {
    // 1. Periodo mas reciente con datos de balance
    const r1 = await db.execute<{ periodo: number }>(sql`
      SELECT MAX(periodo)::int AS periodo
        FROM marts.v_eeff_balance_ancho
    `);
    const periodo = r1[0]?.periodo;
    if (!periodo) return STATIC_FALLBACK;

    // 2. Top 5 bancos individuales por cartera bruta
    const r2 = await db.execute<{ nomb_correg: string }>(sql`
      SELECT b.nomb_correg
        FROM marts.v_eeff_balance_ancho b
       WHERE b.periodo      = ${periodo}
         AND b.moneda       = 'TOTAL'
         AND b.tipo_entidad = 'BANCOS'
         AND b.nomb_correg  NOT LIKE 'Total%'
         AND b.nomb_correg  NOT LIKE '%con Sucursales en el Exterior%'
         AND b.nomb_correg  NOT LIKE '%Incluye Sucursales%'
       ORDER BY COALESCE(b.cta_a4_1, 0) + COALESCE(b.cta_a4_2, 0) + COALESCE(b.cta_a4_3, 0) DESC
       LIMIT 5
    `);
    const entidades = r2.map((r) => r.nomb_correg);
    if (entidades.length === 0) return STATIC_FALLBACK;

    const periodoAnterior = (Math.floor(periodo / 100) - 1) * 100 + (periodo % 100);
    const periodoTtmDesde = ttmDesde(periodo);
    const listaIn = inList(entidades);

    // 3. KPIs: balance actual + anterior + resultados TTM + mora + cobertura
    type KpiRow = {
      nomb_correg:  string;
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
         WHERE periodo    = ${periodo}
           AND moneda     = 'TOTAL'
           AND nomb_correg IN (${listaIn})
      ),
      bg_prev AS (
        SELECT nomb_correg,
               COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0) AS cartera_prev
          FROM marts.v_eeff_balance_ancho
         WHERE periodo    = ${periodoAnterior}
           AND moneda     = 'TOTAL'
           AND nomb_correg IN (${listaIn})
      ),
      er_ttm AS (
        SELECT nomb_correg, SUM(cta_17) AS utilidad_ttm
          FROM marts.mv_eeff_resultados_ancho
         WHERE periodo BETWEEN ${periodoTtmDesde} AND ${periodo}
           AND moneda     = 'TOTAL'
           AND nomb_correg IN (${listaIn})
         GROUP BY nomb_correg
      ),
      mora AS (
        SELECT nomb_correg, pct_mora_global AS mora_global
          FROM marts.v_mora_global_historica
         WHERE periodo    = ${periodo}
           AND nomb_correg IN (${listaIn})
      ),
      car AS (
        SELECT nomb_correg, pct_cobertura_car AS cobertura_car
          FROM marts.v_cobertura_car_historica
         WHERE periodo    = ${periodo}
           AND nomb_correg IN (${listaIn})
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
          if (!cp) return 0;
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
          if (!c) return 0;
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
          if (!p) return 0;
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
          if (!a) return 0;
          return Number(((Number(r.utilidad_ttm) / a) * 100).toFixed(2));
        })),
      },
    ];

    // Validar que la cartera bruta tenga datos reales
    const valid = filas[0]?.valores.some((v) => v !== 0) ?? false;
    if (!valid) return STATIC_FALLBACK;

    // Usar nombres cortos en la UI (los nombres completos de DB son muy largos)
    const entidadesDisplay = entidades.map(abrevEntidad);

    return {
      generatedAt:  new Date().toISOString(),
      periodo,
      periodoLabel: periodoLabel(periodo),
      grupoSbs:     "Banca Múltiple",
      propiaIdx:    0,
      entidades:    entidadesDisplay,
      filas,
    };
  } catch (err) {
    console.error("[fetchMockupData] error — usando fallback JSON:", err);
    return STATIC_FALLBACK;
  }
}
