/**
 * Prompt template para "Cobertura de Cartera" — evalua el aprovisionamiento
 * vs riesgos latentes en cartera. Framework de analisis crediticio: cobertura por CAR y
 * Cartera Problema, compromiso patrimonial.
 *
 * Contexto esperado en ctx.contexto:
 *   serie: Array<{
 *     entidad: string;
 *     provisionesTotal: number;      // MM S/ provisiones acumuladas
 *     carteraProblema: number;       // MM S/ (Atrasada + Refi + Reestruct)
 *     carteraAtrasada: number;       // MM S/
 *     patrimonio: number;            // MM S/
 *     coberturaCar?: number;         // (0-inf, 1=100%) opcional pre-calculado
 *   }>
 */

import { SYSTEM_PROMPT_BASE, type PromptTemplate } from "./base";
import type { PromptContext } from "../types";

type CoberturaRow = {
  entidad: string;
  provisionesTotal: number;
  carteraProblema: number;
  carteraAtrasada: number;
  patrimonio: number;
  coberturaCar?: number;
};

export const promptCobertura: PromptTemplate = {
  version: "v1",
  seccion: "cobertura",
  build(ctx: PromptContext): { system: string; user: string } {
    const serie = (ctx.contexto.serie ?? []) as CoberturaRow[];

    const tabla = serie
      .map((r) => {
        // Cobertura de Cartera Problema = Provisiones / Cartera Problema
        const covProb = r.carteraProblema > 0
          ? (r.provisionesTotal / r.carteraProblema) * 100
          : 0;
        // Cobertura Cartera Atrasada = Provisiones / Cartera Atrasada
        const covAtr = r.carteraAtrasada > 0
          ? (r.provisionesTotal / r.carteraAtrasada) * 100
          : 0;
        // Compromiso Patrimonial = (Cartera Problema - Provisiones) / Patrimonio
        // Si > 0: riesgo latente al patrimonio. Negativo es sano.
        const compPat = r.patrimonio > 0
          ? ((r.carteraProblema - r.provisionesTotal) / r.patrimonio) * 100
          : 0;
        const semaforo =
          compPat < -5 ? "🟢 fuerte cobertura"
          : compPat < 0 ? "🟢 sano"
          : compPat < 10 ? "🟡 vigilancia"
          : "🔴 riesgo latente";
        return `| ${r.entidad.padEnd(30)} | ${covAtr.toFixed(0).padStart(6)}% | ${covProb.toFixed(0).padStart(6)}% | ${(compPat >= 0 ? "+" + compPat.toFixed(2) : compPat.toFixed(2)).padStart(7)}% | ${semaforo} |`;
      })
      .join("\n");

    const user = `# Cobertura de Cartera y Compromiso Patrimonial — ${ctx.periodoLabel}

Cliente objetivo: ${ctx.entidadPropia}
Peer group (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}

Cobertura de provisiones + compromiso patrimonial:
| Entidad                        | Cob Atr | Cob Prob | Comp Patr | Semaforo         |
|--------------------------------|---------|----------|-----------|------------------|
${tabla}

Definiciones (interno, no mencionar en el output):
- Cobertura Cartera Atrasada = Provisiones / Cartera Atrasada (basica). >100% deseable.
- Cobertura Cartera Problema = Provisiones / (Atrasada + Refi + Reestruct). >80% saludable.
- Compromiso Patrimonial = (Cartera Problema - Provisiones) / Patrimonio.
  Negativo: la entidad cubre TODA la Cartera Problema con provisiones + tiene buffer patrimonial.
  Positivo: hay portion sin cobertura que puede erosionar patrimonio si se materializa.
  >10% es alerta severa (clasificadoras suelen bajar rating).
- Semaforo: <-5% muy fuerte, -5%-0% sano, 0-10% vigilancia, >10% riesgo.

Aplica el framework de clasificadora sobre COBERTURA:
- Posicionamiento de ${ctx.entidadPropia}: cobertura vs mediana del peer
- Compromiso Patrimonial: sirve como "colchon" o esta erosionando patrimonio
- Menciona TODAS las entidades. Outliers: quien tiene la mejor cobertura, quien la peor.
- Tendencia sectorial: si la mayoria tiene compromiso positivo, indica presion en el sistema
- Implicancia: capacidad de absorber deterioros futuros sin necesitar aumentos de capital

Output: 5-7 bullets JSON array. Nada mas.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
