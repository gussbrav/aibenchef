/**
 * Prompt template para "Cartera Bruta" — analiza tendencia de tamaño
 * y crecimiento vs peers.
 *
 * Contexto esperado en ctx.contexto:
 *   serie: Array<{
 *     entidad: string;
 *     valorActual: number;       // MM S/ periodo actual
 *     valorAnioPrev: number;     // MM S/ mismo mes ano anterior
 *     crecimientoPct: number;    // (actual - prev) / prev
 *   }>
 */

import { SYSTEM_PROMPT_BASE, type PromptTemplate } from "./base";
import type { PromptContext } from "../types";

type CarteraRow = {
  entidad: string;
  valorActual: number;
  valorAnioPrev: number;
  crecimientoPct: number;
};

export const promptCarteraBruta: PromptTemplate = {
  version: "v3",
  seccion: "cartera_bruta",
  build(ctx: PromptContext): { system: string; user: string } {
    const serie = (ctx.contexto.serie ?? []) as CarteraRow[];

    // Ranking y stats para dar contexto de posicionamiento
    const sortedByCartera = [...serie].sort((a, b) => b.valorActual - a.valorActual);
    const totalPeer = serie.reduce((sum, r) => sum + r.valorActual, 0);
    const mediana = sortedByCartera.length > 0
      ? sortedByCartera[Math.floor(sortedByCartera.length / 2)]!.valorActual
      : 0;
    const crecMediana = (() => {
      const sortedByCrec = [...serie].sort((a, b) => a.crecimientoPct - b.crecimientoPct);
      return sortedByCrec.length > 0
        ? sortedByCrec[Math.floor(sortedByCrec.length / 2)]!.crecimientoPct
        : 0;
    })();

    const tabla = sortedByCartera
      .map((r, idx) => {
        const act = r.valorActual.toLocaleString("es-PE", { maximumFractionDigits: 0 });
        const prev = r.valorAnioPrev.toLocaleString("es-PE", { maximumFractionDigits: 0 });
        const g = r.crecimientoPct * 100;
        const gStr = g >= 0 ? `+${g.toFixed(1)}` : g.toFixed(1);
        const share = totalPeer > 0 ? ((r.valorActual / totalPeer) * 100).toFixed(1) : "0.0";
        return `| ${(idx + 1).toString().padStart(2)} | ${r.entidad.padEnd(30)} | ${act.padStart(12)} | ${prev.padStart(12)} | ${gStr.padStart(6)}% | ${share.padStart(4)}% |`;
      })
      .join("\n");

    const user = `# Cartera Bruta — evolucion ${ctx.periodoAnteriorLabel} → ${ctx.periodoLabel}

Cliente objetivo: ${ctx.entidadPropia}
Peer group (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}

Cartera Bruta en MM S/ (ordenado de mayor a menor):
| #  | Entidad                        | Actual (MM)  | Ano prev (MM)| Crec % | Share |
|----|--------------------------------|--------------|--------------|--------|-------|
${tabla}

Estadisticas del peer:
- Cartera total del peer group: ${totalPeer.toLocaleString("es-PE", { maximumFractionDigits: 0 })} MM S/
- Mediana de cartera: ${mediana.toLocaleString("es-PE", { maximumFractionDigits: 0 })} MM S/
- Mediana de crecimiento YoY: ${(crecMediana * 100).toFixed(1)}%

Aplica el framework completo (posicionamiento, tendencia, outliers, menciones, implicancia, accion) desde la perspectiva de ${ctx.entidadPropia}. Menciona TODAS las ${ctx.peerGroup.length} entidades del peer. Prioriza el analisis de:
- Ranking de tamaño (share vs peer) y velocidad de crecimiento
- Convergencia o divergencia de participaciones (¿alguien esta ganando/perdiendo share?)
- Sostenibilidad del crecimiento (crecimientos >20% anuales requieren mencion de riesgo de calidad de cartera)
- Crecimientos negativos: son estrategicos (limpieza) o preocupantes (perdida de negocio)

Output: 5-7 bullets JSON array. Nada mas.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
