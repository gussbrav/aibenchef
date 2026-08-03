/**
 * Prompt template para "Calidad de Cartera — Mora Global" — analiza
 * salud crediticia del peer group.
 *
 * Contexto esperado en ctx.contexto:
 *   serie: Array<{
 *     entidad: string;
 *     moraActual: number;        // % actual (0-1)
 *     moraAnioPrev: number;      // % mismo mes ano anterior
 *     deltaPp: number;           // pp de diferencia
 *     conVentaCartera?: number;  // opcional: mora ajustada por castigos+venta
 *   }>
 */

import { SYSTEM_PROMPT_BASE, type PromptTemplate } from "./base";
import type { PromptContext } from "../types";

type MoraRow = {
  entidad: string;
  moraActual: number;
  moraAnioPrev: number;
  deltaPp: number;
  conVentaCartera?: number;
};

export const promptMoraGlobal: PromptTemplate = {
  version: "v2",
  seccion: "mora_global",
  build(ctx: PromptContext): { system: string; user: string } {
    const serie = (ctx.contexto.serie ?? []) as MoraRow[];

    // Stats del peer para contexto
    const sortedByMora = [...serie].sort((a, b) => a.moraActual - b.moraActual);
    const mediana = sortedByMora.length > 0
      ? sortedByMora[Math.floor(sortedByMora.length / 2)]!.moraActual
      : 0;
    const mejorMora = sortedByMora[0]?.moraActual ?? 0;
    const peorMora = sortedByMora[sortedByMora.length - 1]?.moraActual ?? 0;

    const tabla = serie
      .map((r) => {
        const act = (r.moraActual * 100).toFixed(2);
        const prev = (r.moraAnioPrev * 100).toFixed(2);
        const d = r.deltaPp;
        const dStr = d >= 0 ? `+${d.toFixed(2)}` : d.toFixed(2);
        const vc = r.conVentaCartera != null ? (r.conVentaCartera * 100).toFixed(2) + "%" : "—";
        const semaforo = d >= 1 ? "🔴 alerta" : d >= 0.3 ? "🟡 deterioro" : d <= -0.3 ? "🟢 mejora" : "⚪ estable";
        return `| ${r.entidad.padEnd(30)} | ${act.padStart(6)}% | ${prev.padStart(6)}% | ${dStr.padStart(7)} pp | ${vc.padStart(6)} | ${semaforo} |`;
      })
      .join("\n");

    const user = `# Calidad de Cartera — Mora Global ${ctx.periodoLabel} vs ${ctx.periodoAnteriorLabel}

Cliente objetivo: ${ctx.entidadPropia}
Peer group (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}

Mora Global (% cartera atrasada / cartera bruta):
| Entidad                        | Actual | Ano prev | Delta    | Con V/C | Tendencia   |
|--------------------------------|--------|----------|----------|---------|-------------|
${tabla}

Estadisticas del peer:
- Mejor mora (menor): ${(mejorMora * 100).toFixed(2)}%
- Peor mora (mayor): ${(peorMora * 100).toFixed(2)}%
- Mediana: ${(mediana * 100).toFixed(2)}%
- Spread mejor→peor: ${((peorMora - mejorMora) * 100).toFixed(2)}pp

Definiciones (para tu razonamiento, no mencionar en el output):
- Mora Global = Cartera Atrasada / Cartera Bruta. Positivo (aumento) es MALO.
- Con V/C = incluye venta de cartera y castigos (indicador ajustado). Si difiere mucho de la basica, el peer esta limpiando activamente su balance.
- Delta > +1pp = alerta severa. Delta entre +0.3 y +1pp = deterioro. Delta entre -0.3 y +0.3 = estable. Delta < -0.3pp = mejora.

Aplica el framework completo desde la perspectiva de ${ctx.entidadPropia}. Menciona TODAS las ${ctx.peerGroup.length} entidades. Prioriza el analisis de:
- Posicionamiento en el ranking de calidad (menor mora = mejor)
- Tendencia YoY: quien mejora, quien deteriora, en cuanto
- Si la mora "con V/C" difiere >30bps de la basica, mencionar que hay actividad de limpieza
- Riesgo sistemico: si >50% del peer deteriora, mencionar contexto macro
- Implicancia para provisiones y RoE si la tendencia continua

Output: 5-7 bullets JSON array. Nada mas.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
