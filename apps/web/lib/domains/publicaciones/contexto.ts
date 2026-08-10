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
import { PublicacionesError } from "./service";
import type { PublicacionTema } from "./types";

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
 * Construye el objeto contexto listo para pasar a generatePublicacion.
 * Cada tema tiene su shape propio (ver prompts/*.ts).
 */
export async function buildContextoForTema(
  input: BuildContextoInput,
): Promise<Record<string, unknown>> {
  const { tema } = input;

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
      return { serie };
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
      return { entidades: entidadesCtx, eventosMacro: input.eventosMacro ?? "" };
    }
    return { entidades: entidadesCtx };
  }

  if (tema === "dupont_rentabilidad") {
    // TODO: reusar queries del dominio dupont (necesita ROE, ROA,
    // apalancamiento, MON, MFB, provisiones, gastos op). Por ahora
    // el tema esta bloqueado hasta la iteracion siguiente.
    throw new PublicacionesError(
      "El tema 'DuPont / Rentabilidad' aun no esta disponible — proximamente.",
      "unsupported_tema",
    );
  }

  throw new PublicacionesError(
    `Tema '${tema}' no soportado en el builder de contexto`,
    "unsupported_tema",
  );
}
