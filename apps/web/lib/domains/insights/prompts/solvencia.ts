/**
 * Prompt template para "Solvencia" — evalua el respaldo patrimonial del
 * peer group vs riesgos asumidos. Framework analitico Moody's.
 *
 * Contexto esperado en ctx.contexto:
 *   serie: Array<{
 *     entidad: string;
 *     roeActual: number;              // % anualizado TTM (0-1)
 *     roeAnioPrev: number;            // mismo mes anio anterior
 *     ratioCapitalGlobal?: number;    // opcional: si tenemos el dato
 *     patrimonioNeto: number;         // MM S/
 *     utilidadTtm: number;            // MM S/
 *   }>
 */

import { SYSTEM_PROMPT_BASE, type PromptTemplate } from "./base";
import type { PromptContext } from "../types";

type SolvenciaRow = {
  entidad: string;
  roeActual: number;
  roeAnioPrev: number;
  ratioCapitalGlobal?: number;
  patrimonioNeto: number;
  utilidadTtm: number;
};

export const promptSolvencia: PromptTemplate = {
  version: "v1",
  seccion: "solvencia",
  build(ctx: PromptContext): { system: string; user: string } {
    const serie = (ctx.contexto.serie ?? []) as SolvenciaRow[];

    const sortedByRoe = [...serie].sort((a, b) => b.roeActual - a.roeActual);
    const medianaRoe = sortedByRoe.length > 0
      ? sortedByRoe[Math.floor(sortedByRoe.length / 2)]!.roeActual
      : 0;
    const mejorRoe = sortedByRoe[0]?.roeActual ?? 0;
    const peorRoe = sortedByRoe[sortedByRoe.length - 1]?.roeActual ?? 0;

    const tabla = serie
      .map((r) => {
        const roeAct = (r.roeActual * 100).toFixed(2);
        const roePrev = (r.roeAnioPrev * 100).toFixed(2);
        const deltaRoe = (r.roeActual - r.roeAnioPrev) * 100;
        const deltaStr = deltaRoe >= 0 ? `+${deltaRoe.toFixed(2)}` : deltaRoe.toFixed(2);
        const patrimonio = r.patrimonioNeto.toLocaleString("es-PE", { maximumFractionDigits: 0 });
        const utilidad = r.utilidadTtm.toLocaleString("es-PE", { maximumFractionDigits: 0 });
        const rcg = r.ratioCapitalGlobal != null
          ? (r.ratioCapitalGlobal * 100).toFixed(2) + "%"
          : "—";
        return `| ${r.entidad.padEnd(30)} | ${roeAct.padStart(6)}% | ${roePrev.padStart(6)}% | ${deltaStr.padStart(7)}pp | ${patrimonio.padStart(10)} | ${utilidad.padStart(10)} | ${rcg.padStart(8)} |`;
      })
      .join("\n");

    const user = `# Solvencia y Rentabilidad Patrimonial — ${ctx.periodoLabel} vs ${ctx.periodoAnteriorLabel}

Cliente objetivo: ${ctx.entidadPropia}
Peer group (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}

ROAE, patrimonio y utilidad TTM:
| Entidad                        | ROAE   | Prev   | Delta   | Patr (MM)  | Util (MM)  | RCG      |
|--------------------------------|--------|--------|---------|------------|------------|----------|
${tabla}

Estadisticas ROAE del peer:
- Mejor: ${(mejorRoe * 100).toFixed(2)}%
- Mediana: ${(medianaRoe * 100).toFixed(2)}%
- Peor: ${(peorRoe * 100).toFixed(2)}%

Definiciones (interno, no mencionar):
- ROAE = Utilidad Neta TTM / Patrimonio Promedio 12m
- Δ Delta ROAE en pp: mejora o deterioro anual
- RCG (Ratio Capital Global) = Patrimonio Efectivo / APR. Minimo SBS 8.5%, buffer conservador >14%.
- Patrimonio = capital + reservas + resultados acumulados
- Utilidad TTM = Trailing 12 Months

Aplica el framework de clasificadora considerando SOLVENCIA:
- Posicionamiento de ${ctx.entidadPropia} en rentabilidad patrimonial vs pares
- Sostenibilidad: ¿la utilidad TTM soporta el crecimiento de patrimonio necesario para colocaciones?
- Si RCG disponible, comentar cobertura del minimo regulatorio
- Menciona TODAS las entidades. Outliers positivos y negativos con causa.
- Medidas mitigantes tipicas que las clasificadoras mencionan: capitalizacion de utilidades, emision bonos subordinados (computan en Nivel 2), aplicacion metodo ASA (reduce APR).
- Implicancia: capacidad de crecimiento organico + necesidad de aumentos de capital

Output: 5-7 bullets JSON array. Nada mas.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
