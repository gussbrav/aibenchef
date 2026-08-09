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
  // Sub-componentes de Gastos Operacionales (para expandir en la tabla).
  // Ya existen pre-calculados en marts.v_punto_equilibrio_ancho.
  pctPersonal?: number | null;
  pctGenerales?: number | null;
  pctDepreciacion?: number | null;
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
 *
 * IMPORTANTE — Canonizacion de nombres: el view v_punto_equilibrio_ancho
 * guarda por nomb_correg SIN fusionar aliases historicos. Para entidades
 * que cambiaron de nombre (ej. BBVA Continental -> Banco BBVA Peru), la
 * data queda partida en 2 registros.
 * Esta query resuelve TODOS los aliases via dw.entidad_maestra +
 * dw.entidad_nombre y hace el WHERE con IN (...aliases) para fusionar
 * la historia completa bajo el nombre canonico actual.
 */
export async function getPuntoEquilibrioHistorico(opts: {
  entidad: string;
  desdeAnio: number;
  hastaPeriodo: number;
  granularidad: Granularidad;
  moneda?: "MN" | "ME" | "TOTAL";
  /** true (default): consolida aliases historicos bajo el canonico actual
   *  (ej. Banco Compartamos incluye su etapa como Financiera). false: solo
   *  la ventana legal actual del canonico. */
  consolidar?: boolean;
}): Promise<PuntoEquilibrioRow[]> {
  const moneda = opts.moneda ?? "TOTAL";
  const consolidar = opts.consolidar !== false;
  const periodos = generarPeriodos(opts.desdeAnio, opts.hastaPeriodo, opts.granularidad);
  if (periodos.length === 0) return [];
  const periodosClause = sql.join(periodos.map((p) => sql`${p}`), sql`, `);

  // Resolver aliases del canonico. Con consolidar=true (default): expandir
  // a TODOS los alias historicos (evolucion completa). Con consolidar=false:
  // SOLO el nombre canonico exacto (ventana legal actual) — el user quiere
  // ver la entidad como identidad legal, no como historia operativa.
  const rows = await db.execute<{
    periodo: number;
    pct_rendimiento: number | null;
    pct_costo_fondeo: number | null;
    pct_provisiones: number | null;
    pct_gastos_op: number | null;
    pct_otros: number | null;
    pct_punto_eq: number | null;
    pct_margen_neto: number | null;
    pct_gastos_personal: number | null;
    pct_gastos_generales: number | null;
    pct_deprec: number | null;
  }>(sql`
    WITH aliases AS (
      ${consolidar
        ? sql`
            SELECT LOWER(TRIM(en.nombre)) AS nombre_lower
            FROM dw.entidad_maestra em
            JOIN dw.entidad_nombre en ON en.entidad_id = em.id
            WHERE em.nomb_correg_canonico = ${opts.entidad}
              AND en.consolidar = TRUE
            UNION
            SELECT LOWER(TRIM(${opts.entidad}::text))
          `
        : sql`SELECT LOWER(TRIM(${opts.entidad}::text)) AS nombre_lower`}
    )
    SELECT DISTINCT ON (v.periodo)
           v.periodo, v.pct_rendimiento, v.pct_costo_fondeo, v.pct_provisiones,
           v.pct_gastos_op, v.pct_otros, v.pct_punto_eq, v.pct_margen_neto,
           v.pct_gastos_personal, v.pct_gastos_generales, v.pct_deprec
    FROM marts.v_punto_equilibrio_ancho v
    WHERE LOWER(TRIM(v.nomb_correg)) IN (SELECT nombre_lower FROM aliases)
      AND v.moneda = ${moneda}
      AND v.periodo IN (${periodosClause})
    ORDER BY v.periodo ASC, v.nomb_correg
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
      pctPersonal: r?.pct_gastos_personal == null ? null : Number(r.pct_gastos_personal),
      pctGenerales: r?.pct_gastos_generales == null ? null : Number(r.pct_gastos_generales),
      pctDepreciacion: r?.pct_deprec == null ? null : Number(r.pct_deprec),
    };
  });
}

/**
 * Comparativo tabla al mismo periodo para N entidades — con canonizacion
 * de aliases (misma logica que getPuntoEquilibrioHistorico).
 */
export async function getPuntoEquilibrioComparativo(opts: {
  entidades: Array<{ nombCorreg: string; color: string; esPropio: boolean }>;
  periodo: number;
  moneda?: "MN" | "ME" | "TOTAL";
  consolidar?: boolean;
}): Promise<PuntoEquilibrioComparativoRow[]> {
  const moneda = opts.moneda ?? "TOTAL";
  const consolidar = opts.consolidar !== false;
  if (opts.entidades.length === 0) return [];
  const entidadesClause = sql.join(
    opts.entidades.map((e) => sql`${e.nombCorreg}`),
    sql`, `,
  );

  // Con consolidar=true: expande cada canonico a sus aliases historicos.
  // Con consolidar=false: solo el nombre canonico exacto (ventana legal).
  const rows = await db.execute<{
    canonico: string;
    pct_rendimiento: number | null;
    pct_costo_fondeo: number | null;
    pct_provisiones: number | null;
    pct_gastos_op: number | null;
    pct_otros: number | null;
    pct_punto_eq: number | null;
    pct_margen_neto: number | null;
  }>(sql`
    WITH entidades_solicitadas AS (
      SELECT unnest(ARRAY[${entidadesClause}]::text[]) AS canonico
    ),
    aliases AS (
      ${consolidar
        ? sql`
            SELECT es.canonico, LOWER(TRIM(en.nombre)) AS nombre_lower
            FROM entidades_solicitadas es
            JOIN dw.entidad_maestra em ON em.nomb_correg_canonico = es.canonico
            JOIN dw.entidad_nombre en ON en.entidad_id = em.id AND en.consolidar = TRUE
            UNION
            SELECT es.canonico, LOWER(TRIM(es.canonico))
            FROM entidades_solicitadas es
          `
        : sql`
            SELECT es.canonico, LOWER(TRIM(es.canonico)) AS nombre_lower
            FROM entidades_solicitadas es
          `}
    )
    SELECT DISTINCT ON (a.canonico)
           a.canonico, v.pct_rendimiento, v.pct_costo_fondeo, v.pct_provisiones,
           v.pct_gastos_op, v.pct_otros, v.pct_punto_eq, v.pct_margen_neto
    FROM aliases a
    JOIN marts.v_punto_equilibrio_ancho v
      ON LOWER(TRIM(v.nomb_correg)) = a.nombre_lower
     AND v.moneda = ${moneda}
     AND v.periodo = ${opts.periodo}
    ORDER BY a.canonico, v.nomb_correg
  `);

  const byEntidad = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byEntidad.set(String(r.canonico), r);

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
 * Series temporales por entidad — para el line chart comparativo.
 * Canoniza aliases igual que las otras queries: cada entidad canonica
 * agrega todos sus nombres historicos para fusionar la serie completa.
 */
export async function getPuntoEquilibrioSeries(opts: {
  entidades: Array<{ nombCorreg: string; color: string; esPropio: boolean }>;
  desdeAnio: number;
  hastaPeriodo: number;
  granularidad: Granularidad;
  moneda?: "MN" | "ME" | "TOTAL";
  consolidar?: boolean;
}): Promise<PuntoEquilibrioSerie[]> {
  const moneda = opts.moneda ?? "TOTAL";
  const consolidar = opts.consolidar !== false;
  if (opts.entidades.length === 0) return [];
  const periodos = generarPeriodos(opts.desdeAnio, opts.hastaPeriodo, opts.granularidad);
  if (periodos.length === 0) return [];

  const entidadesClause = sql.join(
    opts.entidades.map((e) => sql`${e.nombCorreg}`),
    sql`, `,
  );
  const periodosClause = sql.join(periodos.map((p) => sql`${p}`), sql`, `);

  // Con consolidar=true: expande aliases historicos (evolucion completa).
  // Con consolidar=false: solo el nombre canonico exacto (ventana legal).
  const rows = await db.execute<{
    canonico: string;
    periodo: number;
    pct_punto_eq: number | null;
    pct_margen_neto: number | null;
    pct_rendimiento: number | null;
  }>(sql`
    WITH entidades_solicitadas AS (
      SELECT unnest(ARRAY[${entidadesClause}]::text[]) AS canonico
    ),
    aliases AS (
      ${consolidar
        ? sql`
            SELECT es.canonico, LOWER(TRIM(en.nombre)) AS nombre_lower
            FROM entidades_solicitadas es
            JOIN dw.entidad_maestra em ON em.nomb_correg_canonico = es.canonico
            JOIN dw.entidad_nombre en ON en.entidad_id = em.id AND en.consolidar = TRUE
            UNION
            SELECT es.canonico, LOWER(TRIM(es.canonico))
            FROM entidades_solicitadas es
          `
        : sql`
            SELECT es.canonico, LOWER(TRIM(es.canonico)) AS nombre_lower
            FROM entidades_solicitadas es
          `}
    )
    SELECT DISTINCT ON (a.canonico, v.periodo)
           a.canonico, v.periodo, v.pct_punto_eq, v.pct_margen_neto, v.pct_rendimiento
    FROM aliases a
    JOIN marts.v_punto_equilibrio_ancho v
      ON LOWER(TRIM(v.nomb_correg)) = a.nombre_lower
     AND v.moneda = ${moneda}
     AND v.periodo IN (${periodosClause})
    ORDER BY a.canonico, v.periodo ASC, v.nomb_correg
  `);

  const byEntidad = new Map<string, Map<number, (typeof rows)[number]>>();
  for (const r of rows) {
    const k = String(r.canonico);
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
 * Lista de entidades con data de PE, agrupadas por nombre canonico y con
 * rango primer/ultimo periodo FUSIONADO sobre todos los aliases. Asi el
 * dropdown muestra 'Banco BBVA Peru' con rango 201001-202606 (no solo
 * 202304-202606 que es el rango solo del nombre nuevo).
 *
 * Fallback: si un nomb_correg del view no tiene entrada en la maestra,
 * lo devolvemos con su nombre tal cual (compat con data legacy).
 */
export async function listEntidadesConDataPE(): Promise<
  Array<{ nombCorreg: string; primerPeriodo: number; ultimoPeriodo: number }>
> {
  const rows = await db.execute<{
    nomb_correg: string;
    primer_periodo: number;
    ultimo_periodo: number;
  }>(sql`
    WITH pe_por_nombre AS (
      SELECT LOWER(TRIM(nomb_correg)) AS nombre_lower,
             MIN(periodo) AS primer,
             MAX(periodo) AS ultimo
      FROM marts.v_punto_equilibrio_ancho
      WHERE moneda = 'TOTAL'
      GROUP BY LOWER(TRIM(nomb_correg))
    ),
    canonicos AS (
      -- Todos los canonicos con al menos un alias que tiene data en PE
      SELECT em.nomb_correg_canonico AS nomb_correg,
             MIN(pe.primer) AS primer_periodo,
             MAX(pe.ultimo) AS ultimo_periodo
      FROM dw.entidad_maestra em
      JOIN dw.entidad_nombre en ON en.entidad_id = em.id AND en.consolidar = TRUE
      JOIN pe_por_nombre pe ON pe.nombre_lower = LOWER(TRIM(en.nombre))
      GROUP BY em.nomb_correg_canonico
    ),
    huerfanos AS (
      -- Nombres en PE que NO estan en la maestra — devolver tal cual para
      -- no perder data si la maestra esta incompleta.
      SELECT pe.nombre_lower AS nomb_correg,
             pe.primer AS primer_periodo,
             pe.ultimo AS ultimo_periodo
      FROM pe_por_nombre pe
      WHERE NOT EXISTS (
        SELECT 1 FROM dw.entidad_nombre en
        WHERE en.consolidar = TRUE
          AND LOWER(TRIM(en.nombre)) = pe.nombre_lower
      )
    )
    SELECT nomb_correg, primer_periodo, ultimo_periodo FROM canonicos
    UNION ALL
    SELECT nomb_correg, primer_periodo, ultimo_periodo FROM huerfanos
    ORDER BY nomb_correg
  `);
  return rows.map((r) => ({
    nombCorreg: String(r.nomb_correg),
    primerPeriodo: Number(r.primer_periodo),
    ultimoPeriodo: Number(r.ultimo_periodo),
  }));
}
