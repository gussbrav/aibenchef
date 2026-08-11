/**
 * Builder de contextos por tema — recibe {tema, cliente, periodo,
 * peerGroup, entidadPropia} y arma el shape de contexto que espera
 * cada prompt template. Asi el cliente NO tiene que armar el contexto
 * (que involucra queries a las MV).
 *
 * MVP: 3 de 4 temas usan getPuntoEquilibrioSeries. El 4to (dupont)
 * necesitaria queries propias del dominio dupont — pendiente de una
 * segunda iteracion.
 */

import "server-only";

import { getPuntoEquilibrioSeries } from "@/lib/domains/punto-equilibrio";
import { getAnalisisDupont } from "@/lib/domains/dupont";
import { PublicacionesError } from "./service";
import type { PublicacionChart, PublicacionTema } from "./types";
import {
  chartDataToMarkdown,
  getSerieMoraHistorica,
  getSerieRoeHistorica,
} from "./charts/data";
import {
  renderBarChartSvg,
  renderLineChartSvg,
} from "./charts/svg-renderer";

export type BuildContextoInput = {
  tema: PublicacionTema;
  clienteSlug: string;
  entidadPropia: string;
  peerGroup: string[];
  periodo: number;
  /** Opcional — solo aplica a coyuntura_macro. Texto libre del user. */
  eventosMacro?: string;
};

/**
 * Resultado del builder — contexto para el prompt + charts pre-generados
 * a persistir. Los temas "visuales" (mora_visual, rentabilidad_visual)
 * devuelven charts NO-vacios. Los otros temas devuelven charts=[].
 */
export type BuildContextoResult = {
  contexto: Record<string, unknown>;
  charts: PublicacionChart[];
};

/**
 * Construye el objeto contexto + charts pre-generados listos para pasar
 * a generatePublicacion. Cada tema tiene su shape propio (ver prompts/*.ts).
 *
 * Los temas "visuales" generan charts SVG server-side y los devuelven en
 * `charts[]` para persistir junto con el articulo.
 */
export async function buildContextoForTema(
  input: BuildContextoInput,
): Promise<BuildContextoResult> {
  const { tema } = input;

  // ==========================================================================
  // Tema: mora_visual — line chart de mora global mensual (24 meses)
  // ==========================================================================
  if (tema === "mora_visual") {
    const moraData = await getSerieMoraHistorica({
      entidades: input.peerGroup,
      entidadPropia: input.entidadPropia,
      hastaPeriodo: input.periodo,
      mesesAtras: 24,
    });

    if (moraData.series.length === 0) {
      throw new PublicacionesError(
        "No hay data de mora historica para las entidades seleccionadas",
        "parse_error",
      );
    }

    // Ranking del cierre actual — ordenar por menor mora
    const ranking = moraData.series
      .map((s) => {
        const ult = s.puntos[s.puntos.length - 1];
        return ult && ult.valor != null
          ? { entidad: s.nombre, pctMoraActual: ult.valor }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.pctMoraActual - b.pctMoraActual);

    const lider = ranking[0];
    const peor = ranking[ranking.length - 1];
    const entidadPropiaMoraActual = ranking.find(
      (r) => r.entidad === input.entidadPropia,
    )?.pctMoraActual;

    // Variacion 12m — comparar ultimo vs punto de 12 meses atras
    const variacion12m = moraData.series
      .map((s) => {
        const validos = s.puntos.filter((p) => p.valor != null);
        if (validos.length < 12) return null;
        const ult = validos[validos.length - 1];
        const hace12 = validos[Math.max(0, validos.length - 13)];
        if (!ult || !hace12 || ult.valor == null || hace12.valor == null) return null;
        // delta en pbs (1% = 100 pbs). Data ya en %, asi que delta*100 = pbs.
        return { entidad: s.nombre, delta: (ult.valor - hace12.valor) / 100 };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const chartMoraSvg = renderLineChartSvg({
      titulo: `Mora global — ${input.entidadPropia} y grupo comparable`,
      subtitulo: `Últimos 24 meses · Cierre ${input.periodo}`,
      ejeY: "% cartera atrasada / cartera bruta",
      fuente: `SBS Perú · Corte ${publicacionPeriodoLabelShort(input.periodo)}`,
      series: moraData.series,
      formato: "pct",
    });

    const chart: PublicacionChart = {
      id: "chart-mora",
      tipo: "line",
      titulo: `Mora global — ${input.entidadPropia} y grupo comparable`,
      subtitulo: `Últimos 24 meses · Cierre ${input.periodo}`,
      svg: chartMoraSvg,
      altText: `Gráfico de líneas mostrando la evolución mensual del ratio de mora global (cartera atrasada / cartera bruta) de ${input.entidadPropia} y ${input.peerGroup.length} entidades comparables durante los últimos 24 meses. ${lider ? `El líder con menor mora es ${lider.entidad} con ${lider.pctMoraActual.toFixed(2)}%.` : ""} ${peor ? `El rezagado con mayor mora es ${peor.entidad} con ${peor.pctMoraActual.toFixed(2)}%.` : ""}`,
    };

    const moraChartData = chartDataToMarkdown(moraData, {
      titulo: "Mora global mensual (%)",
      formato: "pct",
    });

    return {
      contexto: {
        moraChartData,
        moraChartCaption: `Mora global mensual, ultimos 24 meses`,
        ranking,
        entidadPropiaMoraActual,
        liderMenorMora: lider ? { entidad: lider.entidad, valor: lider.pctMoraActual } : null,
        peorMayorMora: peor ? { entidad: peor.entidad, valor: peor.pctMoraActual } : null,
        variacion12m,
      },
      charts: [chart],
    };
  }

  // ==========================================================================
  // Tema: rentabilidad_visual — line chart ROE anual + bar chart ranking
  // ==========================================================================
  if (tema === "rentabilidad_visual") {
    const roeData = await getSerieRoeHistorica({
      entidades: input.peerGroup,
      entidadPropia: input.entidadPropia,
      hastaPeriodo: input.periodo,
      aniosAtras: 5,
    });

    if (roeData.series.length === 0) {
      throw new PublicacionesError(
        "No hay data de ROE historico para las entidades seleccionadas",
        "parse_error",
      );
    }

    // Ranking del cierre actual — mayor ROE = mejor
    const ranking = roeData.series
      .map((s) => {
        const ult = s.puntos[s.puntos.length - 1];
        return ult && ult.valor != null
          ? { entidad: s.nombre, roeActual: ult.valor }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.roeActual - a.roeActual);

    const lider = ranking[0];
    const peor = ranking[ranking.length - 1];
    const entidadPropiaRoeActual = ranking.find(
      (r) => r.entidad === input.entidadPropia,
    )?.roeActual;

    const chartHistoricoSvg = renderLineChartSvg({
      titulo: `Evolución del ROE — ${input.entidadPropia} y grupo comparable`,
      subtitulo: `Cierres anuales · ${roeData.primerPeriodo}–${roeData.ultimoPeriodo}`,
      ejeY: "% Utilidad TTM / Patrimonio promedio",
      fuente: `SBS Perú · Cierres anuales`,
      series: roeData.series,
      formato: "pct",
    });

    const chartRankingSvg = renderBarChartSvg({
      titulo: `Ranking ROE — Cierre ${publicacionPeriodoLabelShort(input.periodo)}`,
      subtitulo: `${ranking.length} entidades ordenadas de mayor a menor rentabilidad`,
      ejeY: "% ROE",
      fuente: `SBS Perú · Corte ${publicacionPeriodoLabelShort(input.periodo)}`,
      barras: ranking.map((r) => ({
        nombre: r.entidad,
        valor: r.roeActual,
        color:
          roeData.series.find((s) => s.nombre === r.entidad)?.color ?? "#64748b",
        destacada: r.entidad === input.entidadPropia,
      })),
      formato: "pct",
    });

    const charts: PublicacionChart[] = [
      {
        id: "chart-roe-historico",
        tipo: "line",
        titulo: `Evolución del ROE — ${input.entidadPropia} y grupo comparable`,
        subtitulo: `Cierres anuales · ${roeData.primerPeriodo}–${roeData.ultimoPeriodo}`,
        svg: chartHistoricoSvg,
        altText: `Gráfico de líneas mostrando la evolución anual del ROE (Utilidad TTM / Patrimonio promedio 12M) de ${input.entidadPropia} y ${input.peerGroup.length} entidades comparables en los últimos ${(roeData.ultimoPeriodo - roeData.primerPeriodo) / 100 + 1} cierres.`,
      },
      {
        id: "chart-roe-ranking",
        tipo: "bar",
        titulo: `Ranking ROE — Cierre ${publicacionPeriodoLabelShort(input.periodo)}`,
        subtitulo: `${ranking.length} entidades ordenadas de mayor a menor rentabilidad`,
        svg: chartRankingSvg,
        altText: `Gráfico de barras horizontales con el ranking de ROE del cierre ${publicacionPeriodoLabelShort(input.periodo)}. ${lider ? `Lidera ${lider.entidad} con ${lider.roeActual.toFixed(2)}%.` : ""} ${peor ? `Cierra ${peor.entidad} con ${peor.roeActual.toFixed(2)}%.` : ""}`,
      },
    ];

    return {
      contexto: {
        roeChartData: chartDataToMarkdown(roeData, {
          titulo: "ROE anual (%)",
          formato: "pct",
        }),
        roeRankingChartData: ranking
          .map((r, i) => `${i + 1}. ${r.entidad}: ${r.roeActual.toFixed(2)}%`)
          .join("\n"),
        ranking,
        entidadPropiaRoeActual,
        liderRoe: lider ? { entidad: lider.entidad, valor: lider.roeActual } : null,
        peorRoe: peor ? { entidad: peor.entidad, valor: peor.roeActual } : null,
      },
      charts,
    };
  }

  if (
    tema === "benchmarking_sectorial" ||
    tema === "coyuntura_macro" ||
    tema === "evolucion_pe_segmento"
  ) {
    // Estos 3 temas necesitan data del PE. benchmarking_sectorial y
    // coyuntura_macro usan solo el ultimo cierre. evolucion_pe_segmento
    // usa los ultimos 5 cierres anuales.
    const desdeAnio =
      tema === "evolucion_pe_segmento"
        ? Math.floor(input.periodo / 100) - 4
        : Math.floor(input.periodo / 100);

    const entidades = [
      ...(input.peerGroup.includes(input.entidadPropia)
        ? []
        : [input.entidadPropia]),
      ...input.peerGroup,
    ].map((nombCorreg) => ({
      nombCorreg,
      color: "#000",
      esPropio: nombCorreg === input.entidadPropia,
    }));

    const series = await getPuntoEquilibrioSeries({
      entidades,
      desdeAnio,
      hastaPeriodo: input.periodo,
      granularidad: tema === "evolucion_pe_segmento" ? "anual" : "cierre",
      consolidar: true,
    });

    if (tema === "evolucion_pe_segmento") {
      // Shape: { serie: [{ entidad, evolucion: [{ periodo, ... }] }] }
      const serie = series
        .map((s) => ({
          entidad: s.entidad,
          evolucion: s.puntos
            .map((p) => {
              const parts = [p.pctRendimiento, p.pctOtros, p.pctCostoFondeo, p.pctProvisiones, p.pctGastosOp, p.pctMargenNeto];
              if (parts.some((x) => x == null)) return null;
              const puntoEquilibrio =
                (p.pctOtros ?? 0) + (p.pctCostoFondeo ?? 0) + (p.pctProvisiones ?? 0) + (p.pctGastosOp ?? 0);
              return {
                periodo: p.periodo,
                periodoLabel: p.periodoLabel,
                rendimiento: p.pctRendimiento as number,
                puntoEquilibrio,
                margenAntesImpuestos: p.pctMargenNeto as number,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null),
        }))
        .filter((s) => s.evolucion.length > 0);
      return { contexto: { serie }, charts: [] };
    }

    // benchmarking_sectorial + coyuntura_macro: shape es
    // { entidades: [{ entidad, rendimiento, ..., puntoEquilibrio }] }
    const entidadesCtx = series
      .map((s) => {
        const ult = s.puntos[s.puntos.length - 1];
        if (!ult) return null;
        const parts = [ult.pctRendimiento, ult.pctOtros, ult.pctCostoFondeo, ult.pctProvisiones, ult.pctGastosOp, ult.pctMargenNeto];
        if (parts.some((x) => x == null)) return null;
        const puntoEquilibrio =
          (ult.pctOtros as number) +
          (ult.pctCostoFondeo as number) +
          (ult.pctProvisiones as number) +
          (ult.pctGastosOp as number);
        return {
          entidad: s.entidad,
          rendimiento: ult.pctRendimiento as number,
          otros: ult.pctOtros as number,
          gastoFinanciero: ult.pctCostoFondeo as number,
          costoProvision: ult.pctProvisiones as number,
          gastosOp: ult.pctGastosOp as number,
          margenAntesImpuestos: ult.pctMargenNeto as number,
          puntoEquilibrio,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (entidadesCtx.length === 0) {
      throw new PublicacionesError(
        "No hay data del PE para las entidades del peer group en ese cierre",
        "parse_error",
      );
    }

    if (tema === "coyuntura_macro") {
      return {
        contexto: { entidades: entidadesCtx, eventosMacro: input.eventosMacro ?? "" },
        charts: [],
      };
    }
    return { contexto: { entidades: entidadesCtx }, charts: [] };
  }

  if (tema === "dupont_rentabilidad") {
    // Habilitado 2026-08-11 — usa getAnalisisDupont del dominio dupont.
    // Toma el ULTIMO periodo (el cierre pedido) para armar el shape que
    // espera promptDupontRentabilidad: entidades[] con ROE/ROA/apal/etc.
    const entidadesUnicas = Array.from(
      new Set([input.entidadPropia, ...input.peerGroup]),
    );

    const dupontData = await getAnalisisDupont({
      entidades: entidadesUnicas,
      periodos: [input.periodo],
      consolidar: true,
    });

    // Aplanar por entidad — tomar la fila del periodo actual.
    // Shape esperado por el prompt: { entidad, roe, roa, apalancamiento,
    //   mon, mfb, isfn, provisiones, gastosOp, otros, impuestos } todos
    //   como fraccion (0-1), no porcentaje.
    const entidadesCtx = entidadesUnicas
      .map((nomb) => {
        const row = dupontData.filas.find(
          (f) => f.entidad === nomb && f.periodo === input.periodo,
        );
        if (!row) return null;
        // Convertir % (0-100) a fraccion (0-1) para el prompt.
        const pct = (v: number | null | undefined): number | null =>
          v == null ? null : v / 100;
        const roa = pct(row.roaPct);
        const apal = row.apalancamiento;
        const roe = pct(row.roePct);
        if (roa == null || apal == null || roe == null) return null;
        return {
          entidad: nomb,
          roe,
          roa,
          apalancamiento: apal,
          mon: pct(row.margenOpPct) ?? 0,
          mfb: pct(row.mfbPct) ?? 0,
          isfn: pct(row.isfnPct) ?? 0,
          provisiones: pct(row.provisionesPct) ?? 0,
          // gastosOp = personal + generales (los 2 componentes principales)
          gastosOp:
            (pct(row.personalPct) ?? 0) + (pct(row.generalesPct) ?? 0),
          otros: pct(row.otrosIngPct) ?? 0,
          impuestos: pct(row.impuestosPct) ?? 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (entidadesCtx.length === 0) {
      throw new PublicacionesError(
        "No hay data DuPont para las entidades del peer group en ese cierre",
        "parse_error",
      );
    }

    return { contexto: { entidades: entidadesCtx }, charts: [] };
  }

  throw new PublicacionesError(
    `Tema '${tema}' no soportado en el builder de contexto`,
    "unsupported_tema",
  );
}

/**
 * Formatea un periodo YYYYMM como "Jun-26" (formato corto para subtitles
 * de charts y captions donde el espacio es limitado).
 */
const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function publicacionPeriodoLabelShort(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return `${MESES_CORTOS[mes - 1] ?? "?"}-${String(anio).slice(-2)}`;
}
