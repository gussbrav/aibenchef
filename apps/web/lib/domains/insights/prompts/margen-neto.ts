/**
 * Prompt template para insights de la seccion "Analisis Margen Neto"
 * (bubble chart Δ PE vs Δ Rendimiento).
 *
 * Contexto esperado en ctx.contexto:
 *   bubbles: Array<{
 *     entidad: string;         // labelCorto
 *     deltaPe: number;         // pp variacion PE (eje X)
 *     deltaRend: number;       // pp variacion rendimiento (eje Y)
 *     margenNetoActual: number; // pp actual (tamano burbuja)
 *   }>
 */

import { SYSTEM_PROMPT_BASE, type PromptTemplate } from "./base";
import type { PromptContext } from "../types";

type Bubble = {
  entidad: string;
  deltaPe: number;
  deltaRend: number;
  margenNetoActual: number;
};

export const promptMargenNeto: PromptTemplate = {
  version: "v2",
  seccion: "margen_neto",
  build(ctx: PromptContext): { system: string; user: string } {
    const bubbles = (ctx.contexto.bubbles ?? []) as Bubble[];

    // Estadisticas del peer group (mediana + rangos) para dar contexto
    const sortedByMn = [...bubbles].sort((a, b) => a.margenNetoActual - b.margenNetoActual);
    const mediana = sortedByMn.length > 0
      ? sortedByMn[Math.floor(sortedByMn.length / 2)]!.margenNetoActual
      : 0;
    const mnMax = Math.max(...bubbles.map((b) => b.margenNetoActual));
    const mnMin = Math.min(...bubbles.map((b) => b.margenNetoActual));

    const tabla = bubbles
      .map((b) => {
        const pe = b.deltaPe >= 0 ? `+${b.deltaPe.toFixed(2)}` : b.deltaPe.toFixed(2);
        const rend = b.deltaRend >= 0 ? `+${b.deltaRend.toFixed(2)}` : b.deltaRend.toFixed(2);
        const mn = (b.margenNetoActual * 100).toFixed(2);
        const cuadrante =
          b.deltaPe >= 0 && b.deltaRend >= 0 ? "IV (mejor)"
          : b.deltaPe >= 0 && b.deltaRend < 0 ? "III (mejora eficiencia, cae rendimiento)"
          : b.deltaPe < 0 && b.deltaRend >= 0 ? "II (mejora rendimiento, pierde eficiencia)"
          : "I (peor)";
        return `| ${b.entidad.padEnd(30)} | ${pe.padStart(7)} pp | ${rend.padStart(7)} pp | ${mn.padStart(6)}% | ${cuadrante} |`;
      })
      .join("\n");

    const user = `# Analisis Margen Neto — ${ctx.periodoLabel} vs ${ctx.periodoAnteriorLabel}

Cliente objetivo: ${ctx.entidadPropia}
Peer group (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}

Data del bubble chart (variacion YoY en puntos porcentuales):
| Entidad                        | Δ PE    | Δ Rend  | %MN act | Cuadrante |
|--------------------------------|---------|---------|---------|-----------|
${tabla}

Estadisticas del peer:
- Mediana de %Margen Neto: ${(mediana * 100).toFixed(2)}%
- Rango: ${(mnMin * 100).toFixed(2)}% — ${(mnMax * 100).toFixed(2)}%
- Spread: ${((mnMax - mnMin) * 100).toFixed(2)}pp

Definiciones (para tu razonamiento, no mencionar en el output):
- Δ PE > 0: mejora estructural (costos operativos bajan como % de cartera). Cuadrante deseable en X positivo.
- Δ Rend > 0: mejora organica (mayor rentabilidad de activos productivos). Cuadrante deseable en Y positivo.
- Cuadrante IV (X+, Y+) es el ideal: ambos motores tirando. Cuadrante I es alerta.

Aplica el framework completo (posicionamiento, tendencia, outliers, menciones, implicancia, accion) desde la perspectiva de ${ctx.entidadPropia}. Menciona TODAS las ${ctx.peerGroup.length} entidades. Output: 5-7 bullets JSON array. Nada mas.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
