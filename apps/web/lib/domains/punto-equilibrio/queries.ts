/**
 * Queries del modulo Punto de Equilibrio.
 *
 * Consume marts.v_punto_equilibrio_ancho (V034) que ya tiene los 10 KPIs
 * pre-computados por (periodo, nomb_correg, moneda). Sin recompute.
 *
 * Dos vistas principales:
 *  1. getPuntoEquilibrioHistoricoAnual(entidad, hastaPeriodo) — cierres
 *     Diciembre desde 2021 + mes actual + mismo mes ano previo. Formato
 *     tipo cuadro de gerencia (screenshot que compartio el usuario).
 *  2. getPuntoEquilibrioComparativo(entidades[], periodo) — mismo periodo
 *     para N entidades side-by-side.
 */

import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";

export type PuntoEquilibrioRow = {
  /** YYYYMM. */
  periodo: number;
  /** Label legible: 'Dic 2024', 'Jun 2026', etc. */
  periodoLabel: string;
  pctRendimiento: number | null;
  pctOtros: number | null;
  pctCostoFondeo: number | null;
  pctProvisiones: number | null;
  pctGastosOp: number | null;
  pctMargenNeto: number | null;
  pctPuntoEq: number | null;
};

export type PuntoEquilibrioComparativoRow = {
  entidad: string;
  color: string;
  esPropio: boolean;
} & Omit<PuntoEquilibrioRow, "periodo" | "periodoLabel">;

const MESES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatPeriodo(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return `${MESES_ES[mes - 1] ?? "?"} ${anio}`;
}

/**
 * Historico anual del PE para UNA entidad. Devuelve:
 *   - Cierres de Diciembre desde `desdeAnio` hasta el ultimo Dic completo
 *   - Mismo mes del año previo al periodoActual (para comparacion YoY)
 *   - periodoActual (ej. Jun-26)
 *
 * Todos ordenados cronologicamente ASC. Los meses que no existen en el
 * view aparecen como fila con todos los pct en null (no se filtran para
 * que la UI muestre "—" y sea claro que falta data).
 */
export async function getPuntoEquilibrioHistoricoAnual(opts: {
  entidad: string;
  periodoActual: number;
  desdeAnio?: number;
  moneda?: "MN" | "ME" | "TOTAL";
}): Promise<PuntoEquilibrioRow[]> {
  const moneda = opts.moneda ?? "TOTAL";
  const desdeAnio = opts.desdeAnio ?? 2021;
  const anioActual = Math.floor(opts.periodoActual / 100);
  const mesActual = opts.periodoActual % 100;

  // Construir la lista de periodos objetivo:
  //   - Diciembre de cada año desde desdeAnio hasta anioActual-1
  //   - Mismo mes del año previo (ej. Jun-25 si actual es Jun-26)
  //   - Periodo actual (Jun-26)
  // Si el actual ES Diciembre, no duplicamos.
  const periodosObjetivo = new Set<number>();
  for (let a = desdeAnio; a < anioActual; a++) {
    periodosObjetivo.add(a * 100 + 12);
  }
  if (mesActual !== 12) {
    periodosObjetivo.add((anioActual - 1) * 100 + mesActual);
  }
  periodosObjetivo.add(opts.periodoActual);

  const periodos = Array.from(periodosObjetivo).sort((a, b) => a - b);
  const periodosClause = sql.join(periodos.map((p) => sql`${p}`), sql`, `);

  const rows = await db.execute<{
    periodo: number;
    pct_rendimiento: number | null;
    pct_costo_fondeo: number | null;
    pct_provisiones: number | null;
    pct_gastos_op: number | null;
    pct_otros: number | null;
    pct_punto_eq: number | null;
    pct_margen_neto: number | null;
  }>(sql`
    SELECT periodo, pct_rendimiento, pct_costo_fondeo, pct_provisiones,
           pct_gastos_op, pct_otros, pct_punto_eq, pct_margen_neto
    FROM marts.v_punto_equilibrio_ancho
    WHERE nomb_correg = ${opts.entidad}
      AND moneda = ${moneda}
      AND periodo IN (${periodosClause})
    ORDER BY periodo ASC
  `);

  const rowsByPeriodo = new Map<number, (typeof rows)[number]>();
  for (const r of rows) rowsByPeriodo.set(Number(r.periodo), r);

  // Devolver TODOS los periodos objetivo — los que no existen quedan
  // como fila con nulls (UI muestra "—" para reflejar dato faltante).
  return periodos.map((p) => {
    const r = rowsByPeriodo.get(p);
    return {
      periodo: p,
      periodoLabel: formatPeriodo(p),
      pctRendimiento: r?.pct_rendimiento == null ? null : Number(r.pct_rendimiento),
      pctOtros: r?.pct_otros == null ? null : Number(r.pct_otros),
      pctCostoFondeo: r?.pct_costo_fondeo == null ? null : Number(r.pct_costo_fondeo),
      pctProvisiones: r?.pct_provisiones == null ? null : Number(r.pct_provisiones),
      pctGastosOp: r?.pct_gastos_op == null ? null : Number(r.pct_gastos_op),
      pctMargenNeto: r?.pct_margen_neto == null ? null : Number(r.pct_margen_neto),
      pctPuntoEq: r?.pct_punto_eq == null ? null : Number(r.pct_punto_eq),
    };
  });
}

/**
 * Comparativo del PE al mismo periodo para N entidades. Formato ideal
 * para ver 'quien esta mejor parado' hoy — misma fecha, N columnas.
 */
export async function getPuntoEquilibrioComparativo(opts: {
  entidades: Array<{ nombCorreg: string; color: string; esPropio: boolean }>;
  periodo: number;
  moneda?: "MN" | "ME" | "TOTAL";
}): Promise<PuntoEquilibrioComparativoRow[]> {
  const moneda = opts.moneda ?? "TOTAL";
  if (opts.entidades.length === 0) return [];
  const entidadesClause = sql.join(
    opts.entidades.map((e) => sql`${e.nombCorreg}`),
    sql`, `,
  );

  const rows = await db.execute<{
    nomb_correg: string;
    pct_rendimiento: number | null;
    pct_costo_fondeo: number | null;
    pct_provisiones: number | null;
    pct_gastos_op: number | null;
    pct_otros: number | null;
    pct_punto_eq: number | null;
    pct_margen_neto: number | null;
  }>(sql`
    SELECT nomb_correg, pct_rendimiento, pct_costo_fondeo, pct_provisiones,
           pct_gastos_op, pct_otros, pct_punto_eq, pct_margen_neto
    FROM marts.v_punto_equilibrio_ancho
    WHERE nomb_correg IN (${entidadesClause})
      AND moneda = ${moneda}
      AND periodo = ${opts.periodo}
  `);

  const byEntidad = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byEntidad.set(String(r.nomb_correg), r);

  // Preservar el orden pasado por el caller (mismo orden que peer group)
  return opts.entidades.map((e) => {
    const r = byEntidad.get(e.nombCorreg);
    return {
      entidad: e.nombCorreg,
      color: e.color,
      esPropio: e.esPropio,
      pctRendimiento: r?.pct_rendimiento == null ? null : Number(r.pct_rendimiento),
      pctOtros: r?.pct_otros == null ? null : Number(r.pct_otros),
      pctCostoFondeo: r?.pct_costo_fondeo == null ? null : Number(r.pct_costo_fondeo),
      pctProvisiones: r?.pct_provisiones == null ? null : Number(r.pct_provisiones),
      pctGastosOp: r?.pct_gastos_op == null ? null : Number(r.pct_gastos_op),
      pctMargenNeto: r?.pct_margen_neto == null ? null : Number(r.pct_margen_neto),
      pctPuntoEq: r?.pct_punto_eq == null ? null : Number(r.pct_punto_eq),
    };
  });
}
