/**
 * Queries del modulo Punto de Equilibrio.
 *
 * Consume marts.v_punto_equilibrio_ancho (V034). Los valores del view estan
 * en formato DECIMAL (0.0963 = 9.63%), no porcentaje — la UI multiplica x100
 * al mostrar via fmtPct().
 */

import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";

export type Granularidad = "anual" | "semestral" | "trimestral" | "mensual";

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

/**
 * Serie temporal de una entidad — para el line chart comparativo.
 */
export type PuntoEquilibrioSerie = {
  entidad: string;
  color: string;
  esPropio: boolean;
  puntos: Array<{
    periodo: number;
    periodoLabel: string;
    pctPuntoEq: number | null;
    pctMargenNeto: number | null;
    pctRendimiento: number | null;
  }>;
};

const MESES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatPeriodo(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return `${MESES_ES[mes - 1] ?? "?"} ${anio}`;
}

/**
 * Devuelve la lista de meses que corresponden a la granularidad elegida
 * en un año dado.
 *   anual      -> [12]
 *   semestral  -> [6, 12]
 *   trimestral -> [3, 6, 9, 12]
 *   mensual    -> [1..12]
 */
function mesesDeGranularidad(g: Granularidad): number[] {
  switch (g) {
    case "anual": return [12];
    case "semestral": return [6, 12];
    case "trimestral": return [3, 6, 9, 12];
    case "mensual": return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  }
}

/**
 * Genera los periodos objetivo entre [desdeAnio, hastaPeriodo] segun
 * granularidad. Siempre incluye el hastaPeriodo (aunque no coincida con la
 * granularidad) para que el usuario vea siempre el "actual".
 */
function generarPeriodos(
  desdeAnio: number,
  hastaPeriodo: number,
  granularidad: Granularidad,
): number[] {
  const hastaAnio = Math.floor(hastaPeriodo / 100);
  const hastaMes = hastaPeriodo % 100;
  const meses = mesesDeGranularidad(granularidad);
  const set = new Set<number>();

  for (let a = desdeAnio; a <= hastaAnio; a++) {
    for (const m of meses) {
      const p = a * 100 + m;
      if (p <= hastaPeriodo) set.add(p);
    }
  }
  // Siempre asegurar el actual (aunque no coincida con la granularidad)
  set.add(hastaPeriodo);
  // Para granularidad != mensual, agregar tambien el mismo mes del año previo
  // asi el usuario ve la comparacion YoY estilo 'Jun-25 vs Jun-26'
  if (granularidad !== "mensual" && hastaMes !== 12) {
    set.add((hastaAnio - 1) * 100 + hastaMes);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Historico del PE para UNA entidad en un rango dado + granularidad.
 */
export async function getPuntoEquilibrioHistorico(opts: {
  entidad: string;
  desdeAnio: number;
  hastaPeriodo: number;
  granularidad: Granularidad;
  moneda?: "MN" | "ME" | "TOTAL";
}): Promise<PuntoEquilibrioRow[]> {
  const moneda = opts.moneda ?? "TOTAL";
  const periodos = generarPeriodos(opts.desdeAnio, opts.hastaPeriodo, opts.granularidad);
  if (periodos.length === 0) return [];
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

  const byPeriodo = new Map<number, (typeof rows)[number]>();
  for (const r of rows) byPeriodo.set(Number(r.periodo), r);

  return periodos.map((p) => {
    const r = byPeriodo.get(p);
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
 * Comparativo tabla al mismo periodo para N entidades.
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

/**
 * Series temporales por entidad — para el line chart comparativo que
 * muestra evolucion del PE (o margen o rendimiento) en el tiempo lado
 * a lado.
 */
export async function getPuntoEquilibrioSeries(opts: {
  entidades: Array<{ nombCorreg: string; color: string; esPropio: boolean }>;
  desdeAnio: number;
  hastaPeriodo: number;
  granularidad: Granularidad;
  moneda?: "MN" | "ME" | "TOTAL";
}): Promise<PuntoEquilibrioSerie[]> {
  const moneda = opts.moneda ?? "TOTAL";
  if (opts.entidades.length === 0) return [];
  const periodos = generarPeriodos(opts.desdeAnio, opts.hastaPeriodo, opts.granularidad);
  if (periodos.length === 0) return [];

  const entidadesClause = sql.join(
    opts.entidades.map((e) => sql`${e.nombCorreg}`),
    sql`, `,
  );
  const periodosClause = sql.join(periodos.map((p) => sql`${p}`), sql`, `);

  const rows = await db.execute<{
    nomb_correg: string;
    periodo: number;
    pct_punto_eq: number | null;
    pct_margen_neto: number | null;
    pct_rendimiento: number | null;
  }>(sql`
    SELECT nomb_correg, periodo, pct_punto_eq, pct_margen_neto, pct_rendimiento
    FROM marts.v_punto_equilibrio_ancho
    WHERE nomb_correg IN (${entidadesClause})
      AND moneda = ${moneda}
      AND periodo IN (${periodosClause})
    ORDER BY nomb_correg, periodo ASC
  `);

  const byEntidad = new Map<string, Map<number, (typeof rows)[number]>>();
  for (const r of rows) {
    const k = String(r.nomb_correg);
    if (!byEntidad.has(k)) byEntidad.set(k, new Map());
    byEntidad.get(k)!.set(Number(r.periodo), r);
  }

  return opts.entidades.map((e) => {
    const entMap = byEntidad.get(e.nombCorreg) ?? new Map();
    return {
      entidad: e.nombCorreg,
      color: e.color,
      esPropio: e.esPropio,
      puntos: periodos.map((p) => {
        const r = entMap.get(p);
        return {
          periodo: p,
          periodoLabel: formatPeriodo(p),
          pctPuntoEq: r?.pct_punto_eq == null ? null : Number(r.pct_punto_eq),
          pctMargenNeto: r?.pct_margen_neto == null ? null : Number(r.pct_margen_neto),
          pctRendimiento: r?.pct_rendimiento == null ? null : Number(r.pct_rendimiento),
        };
      }),
    };
  });
}

/**
 * Lista de todas las entidades con data de PE — para el selector.
 */
export async function listEntidadesConDataPE(): Promise<
  Array<{ nombCorreg: string; primerPeriodo: number; ultimoPeriodo: number }>
> {
  const rows = await db.execute<{
    nomb_correg: string;
    primer_periodo: number;
    ultimo_periodo: number;
  }>(sql`
    SELECT nomb_correg,
           MIN(periodo) AS primer_periodo,
           MAX(periodo) AS ultimo_periodo
    FROM marts.v_punto_equilibrio_ancho
    WHERE moneda = 'TOTAL'
    GROUP BY nomb_correg
    ORDER BY nomb_correg
  `);
  return rows.map((r) => ({
    nombCorreg: String(r.nomb_correg),
    primerPeriodo: Number(r.primer_periodo),
    ultimoPeriodo: Number(r.ultimo_periodo),
  }));
}
