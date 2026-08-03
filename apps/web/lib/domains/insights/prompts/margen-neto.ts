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
  version: "v1",
  seccion: "margen_neto",
  build(ctx: PromptContext): { system: string; user: string } {
    const bubbles = (ctx.contexto.bubbles ?? []) as Bubble[];

    const tabla = bubbles
      .map((b) => {
        const pe = b.deltaPe.toFixed(2);
        const rend = b.deltaRend.toFixed(2);
        const mn = (b.margenNetoActual * 100).toFixed(2);
        return `| ${b.entidad.padEnd(30)} | ${pe.padStart(7)} pp | ${rend.padStart(7)} pp | ${mn.padStart(6)}% |`;
      })
      .join("\n");

    const user = `# Analisis Margen Neto — ${ctx.periodoLabel} vs ${ctx.periodoAnteriorLabel}

Cliente: ${ctx.entidadPropia} (analiza desde SU perspectiva)
Peer group: ${ctx.peerGroup.join(", ")}

Variacion en puntos porcentuales (pp):
| Entidad                        | Δ PE    | Δ Rend  | %MN act |
|--------------------------------|---------|---------|---------|
${tabla}

Definiciones:
- Δ PE (Punto de Equilibrio): variacion vs ${ctx.periodoAnteriorLabel} en pp. Positivo = mejora (costos bajan). Negativo = deterioro.
- Δ Rend (Rendimiento Cartera): variacion en pp. Positivo = mejora (mayor rentabilidad de activos productivos).
- %MN act: margen neto actual del periodo ${ctx.periodoLabel}. Es el tamanio de la burbuja en el chart.

Genera 3-5 bullets ejecutivos:
- Que le paso a ${ctx.entidadPropia} vs los pares (cuadrante que ocupa en el bubble).
- Cual entidad tiene mejor combinacion Δ PE + Δ Rend. Cual la peor.
- Explicar la CAUSA principal (mejor rendimiento? mejor eficiencia? o ambas?).
- Recomendacion accionable si el cliente esta en desventaja.

Devolver SOLO el JSON array de strings. Sin markdown ni texto extra.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
