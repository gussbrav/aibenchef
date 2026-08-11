/**
 * Queries + orchestration para obtener las series historicas que
 * alimentan los charts SVG de los articulos.
 *
 * Todo server-side (import "server-only"). Consumido desde
 * publicaciones/service.ts durante la fase de "buildContexto".
 *
 * Series soportadas:
 *   - Mora global historica  (marts.v_mora_global_historica, mensual)
 *   - Rentabilidad ROE anual (marts.v_kpis_anuales_historica, anual)
 *
 * Cada funcion recibe (entidades, hastaPeriodo, ventana) y devuelve un
 * shape `ChartData` listo para el renderer + para el prompt del LLM.
 */

import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import { pickColorEstable } from "@/lib/domains/informe/queries";
import type { ChartSerie } from "./svg-renderer";

// =============================================================================
// Types
// =============================================================================

export type ChartData = {
  /** Series listas para el SVG renderer + para pasar al LLM en el prompt. */
  series: ChartSerie[];
  /** Ultimo periodo con data (para el subtitulo del chart). */
  ultimoPeriodo: number;
  /** Primer periodo con data. */
  primerPeriodo: number;
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Restar N meses a un periodo YYYYMM.
 * Ej: minusMonths(202606, 24) = 202406
 */
function minusMonths(yyyymm: number, months: number): number {
  const anio = Math.floor(yyyymm / 100);
  const mes = yyyymm % 100;
  let total = anio * 12 + (mes - 1) - months;
  const newAnio = Math.floor(total / 12);
  const newMes = (total % 12) + 1;
  return newAnio * 100 + newMes;
}

/**
 * Asigna colores estables por entidad. La entidad propia se pinta en el
 * color de marca del cliente (fallback: brand blue). El resto con colores
 * consistentes cross-vista (mismo helper que el /informe).
 */
function assignColors(
  entidades: string[],
  entidadPropia: string,
): Map<string, string> {
  const colors = new Map<string, string>();
  colors.set(entidadPropia, "#0F2A5E"); // brand-900 fijo para la propia
  const usados = new Set<string>(["#0F2A5E"]);
  for (const e of entidades) {
    if (colors.has(e)) continue;
    const c = pickColorEstable(e, usados);
    usados.add(c);
    colors.set(e, c);
  }
  return colors;
}

// =============================================================================
// Mora global historica (mensual)
// =============================================================================

/**
 * Serie mensual de % mora global (cartera atrasada / cartera bruta).
 * Ventana default: 24 meses hacia atras desde hastaPeriodo.
 */
export async function getSerieMoraHistorica(opts: {
  entidades: string[];
  entidadPropia: string;
  hastaPeriodo: number;
  mesesAtras?: number;
}): Promise<ChartData> {
  const mesesAtras = opts.mesesAtras ?? 24;
  const desdePeriodo = minusMonths(opts.hastaPeriodo, mesesAtras);
  const entidadesUnicas = Array.from(
    new Set([opts.entidadPropia, ...opts.entidades]),
  );

  const entidadesSql = sql.join(
    entidadesUnicas.map((e) => sql`${e}`),
    sql`, `,
  );

  const rows = await db.execute<{
    periodo: number;
    nomb_correg: string;
    pct_mora: number | null;
  }>(sql`
    SELECT periodo, nomb_correg,
           (pct_mora_global * 100)::numeric AS pct_mora
      FROM marts.v_mora_global_historica
     WHERE nomb_correg IN (${entidadesSql})
       AND periodo BETWEEN ${desdePeriodo}::int AND ${opts.hastaPeriodo}::int
     ORDER BY nomb_correg, periodo
  `);

  const colors = assignColors(entidadesUnicas, opts.entidadPropia);

  // Agrupar por entidad, mantener orden: propia primero
  const byEntidad = new Map<string, Array<{ periodo: number; valor: number | null }>>();
  for (const r of rows) {
    const key = String(r.nomb_correg);
    if (!byEntidad.has(key)) byEntidad.set(key, []);
    byEntidad.get(key)!.push({
      periodo: Number(r.periodo),
      valor: r.pct_mora == null ? null : Number(r.pct_mora),
    });
  }

  const series: ChartSerie[] = entidadesUnicas
    .filter((e) => byEntidad.has(e))
    .map((e) => ({
      nombre: e,
      color: colors.get(e) ?? "#64748b",
      destacada: e === opts.entidadPropia,
      puntos: byEntidad.get(e) ?? [],
    }));

  const todosPeriodos = rows.map((r) => Number(r.periodo));
  return {
    series,
    ultimoPeriodo: todosPeriodos.length > 0 ? Math.max(...todosPeriodos) : opts.hastaPeriodo,
    primerPeriodo: todosPeriodos.length > 0 ? Math.min(...todosPeriodos) : desdePeriodo,
  };
}

// =============================================================================
// Rentabilidad ROE historica (anual)
// =============================================================================

/**
 * Serie anual de ROE = utilidad TTM / patrimonio promedio 12M.
 * Ventana default: ultimos 5 diciembres.
 *
 * Fix 2026-08-10: query directa a v_kpis_anuales_entidad (usa cierres
 * anuales — diciembre de cada anio + el ultimo periodo si es != dic).
 */
export async function getSerieRoeHistorica(opts: {
  entidades: string[];
  entidadPropia: string;
  hastaPeriodo: number;
  aniosAtras?: number;
}): Promise<ChartData> {
  const aniosAtras = opts.aniosAtras ?? 5;
  const anioHasta = Math.floor(opts.hastaPeriodo / 100);
  const anioDesde = anioHasta - aniosAtras;

  const entidadesUnicas = Array.from(
    new Set([opts.entidadPropia, ...opts.entidades]),
  );
  const entidadesSql = sql.join(
    entidadesUnicas.map((e) => sql`${e}`),
    sql`, `,
  );

  // Cierres anuales = diciembres (mes=12) + el ultimo periodo si es != dic.
  // Usamos v_kpis_anuales_entidad que ya tiene utilidad_ttm + patrimonio_prom_12m.
  const rows = await db.execute<{
    periodo: number;
    nomb_correg: string;
    roe: number | null;
  }>(sql`
    SELECT periodo, nomb_correg,
           CASE
             WHEN patrimonio_prom_12m > 0
               THEN (utilidad_ttm / patrimonio_prom_12m * 100)::numeric
             ELSE NULL
           END AS roe
      FROM marts.v_kpis_anuales_entidad
     WHERE nomb_correg IN (${entidadesSql})
       AND (
         (periodo % 100 = 12 AND periodo / 100 BETWEEN ${anioDesde}::int AND ${anioHasta}::int - 1)
         OR periodo = ${opts.hastaPeriodo}::int
       )
     ORDER BY nomb_correg, periodo
  `);

  const colors = assignColors(entidadesUnicas, opts.entidadPropia);

  const byEntidad = new Map<string, Array<{ periodo: number; valor: number | null }>>();
  for (const r of rows) {
    const key = String(r.nomb_correg);
    if (!byEntidad.has(key)) byEntidad.set(key, []);
    byEntidad.get(key)!.push({
      periodo: Number(r.periodo),
      valor: r.roe == null ? null : Number(r.roe),
    });
  }

  const series: ChartSerie[] = entidadesUnicas
    .filter((e) => byEntidad.has(e))
    .map((e) => ({
      nombre: e,
      color: colors.get(e) ?? "#64748b",
      destacada: e === opts.entidadPropia,
      puntos: byEntidad.get(e) ?? [],
    }));

  const todosPeriodos = rows.map((r) => Number(r.periodo));
  return {
    series,
    ultimoPeriodo: todosPeriodos.length > 0 ? Math.max(...todosPeriodos) : opts.hastaPeriodo,
    primerPeriodo: todosPeriodos.length > 0 ? Math.min(...todosPeriodos) : anioDesde * 100 + 12,
  };
}

// =============================================================================
// Serialize a shape para el prompt del LLM
// =============================================================================

/**
 * Serializa un ChartData a una tabla markdown que el LLM puede leer.
 * El LLM usa esto para escribir la "lectura del chart" en la prosa.
 */
export function chartDataToMarkdown(
  data: ChartData,
  opts: { titulo: string; formato: "pct" | "decimal"; unidad?: string },
): string {
  const sufijo = opts.formato === "pct" ? "%" : (opts.unidad ?? "");
  const periodos = Array.from(
    new Set(data.series.flatMap((s) => s.puntos.map((p) => p.periodo))),
  ).sort((a, b) => a - b);

  const header = "| Entidad | " + periodos.map(periodoLabelCorto).join(" | ") + " |";
  const separator = "|---|" + periodos.map(() => "---").join("|") + "|";
  const filas = data.series.map((s) => {
    const cells = periodos.map((p) => {
      const punto = s.puntos.find((x) => x.periodo === p);
      if (!punto || punto.valor == null) return "—";
      return `${punto.valor.toFixed(2)}${sufijo}`;
    });
    const marca = s.destacada ? " ← ENTIDAD PROPIA" : "";
    return `| ${s.nombre}${marca} | ${cells.join(" | ")} |`;
  });

  return `**${opts.titulo}**\n\n${header}\n${separator}\n${filas.join("\n")}`;
}

const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function periodoLabelCorto(codigo: number): string {
  const anio = Math.floor(codigo / 100);
  const mes = codigo % 100;
  return `${MESES_CORTOS[mes - 1] ?? "?"}-${String(anio).slice(-2)}`;
}
