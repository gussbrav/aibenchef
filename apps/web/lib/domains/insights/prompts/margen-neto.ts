/**
 * Prompt template para insights de la seccion "Analisis Margen Neto"
 * (bubble chart Δ PE vs Δ Rendimiento + waterfall causal).
 *
 * Contexto esperado en ctx.contexto:
 *   bubbles: Array<{
 *     entidad: string;
 *     deltaPe: number;         // pp variacion PE (eje X)
 *     deltaRend: number;       // pp variacion rendimiento (eje Y)
 *     margenNetoActual: number; // pp actual (tamano burbuja)
 *   }>
 *   waterfallYoY: {
 *     periodoBaseLabel: string;
 *     periodoFinalLabel: string;
 *     series: Array<{
 *       entidad: string;
 *       basePct: number; finalPct: number; totalBps: number;
 *       componentes: Array<{ label: string; bps: number }>;
 *     }>
 *   }
 *   waterfallVsDic: idem
 *
 * El waterfall es la "causa" del movimiento del margen — descompone en
 * bps cada driver (rendimiento, costo fondeo, provisiones, gastos op).
 * Sin waterfall el analisis es descriptivo, con waterfall es causal.
 */

import { SYSTEM_PROMPT_BASE, type PromptTemplate } from "./base";
import type { PromptContext } from "../types";

type Bubble = {
  entidad: string;
  deltaPe: number;
  deltaRend: number;
  margenNetoActual: number;
};

type WaterfallSerie = {
  entidad: string;
  basePct: number;
  finalPct: number;
  totalBps: number;
  componentes: Array<{ label: string; bps: number }>;
};

type Waterfall = {
  periodoBaseLabel: string;
  periodoFinalLabel: string;
  series: WaterfallSerie[];
};

function formatWaterfallTabla(w: Waterfall, entidadPropia: string): string {
  if (!w?.series?.length) return "(sin datos)";
  const encabezado = `## Cascada de Margen Neto — ${w.periodoBaseLabel} → ${w.periodoFinalLabel}`;
  const filas = w.series
    .map((s) => {
      const total = s.totalBps >= 0 ? `+${s.totalBps.toFixed(0)}` : s.totalBps.toFixed(0);
      const marca = s.entidad === entidadPropia ? " [ENTIDAD PROPIA]" : "";
      const desglose = s.componentes
        .map((c) => {
          const bps = c.bps >= 0 ? `+${c.bps.toFixed(0)}` : c.bps.toFixed(0);
          return `${c.label}: ${bps} bps`;
        })
        .join(" | ");
      return `- ${s.entidad}${marca}: ${(s.basePct * 100).toFixed(2)}% → ${(s.finalPct * 100).toFixed(2)}% (total ${total} bps). Descomposicion: ${desglose}`;
    })
    .join("\n");
  return `${encabezado}\n${filas}`;
}

export const promptMargenNeto: PromptTemplate = {
  version: "v4",
  seccion: "margen_neto",
  build(ctx: PromptContext): { system: string; user: string } {
    const bubbles = (ctx.contexto.bubbles ?? []) as Bubble[];
    const waterfallYoY = ctx.contexto.waterfallYoY as Waterfall | undefined;
    const waterfallVsDic = ctx.contexto.waterfallVsDic as Waterfall | undefined;

    // Estadisticas del grupo — promedio simple para dar contexto
    const promedio = bubbles.length > 0
      ? bubbles.reduce((sum, b) => sum + b.margenNetoActual, 0) / bubbles.length
      : 0;
    const mnMax = Math.max(...bubbles.map((b) => b.margenNetoActual));
    const mnMin = Math.min(...bubbles.map((b) => b.margenNetoActual));

    const tablaBubbles = bubbles
      .map((b) => {
        const pe = b.deltaPe >= 0 ? `+${b.deltaPe.toFixed(2)}` : b.deltaPe.toFixed(2);
        const rend = b.deltaRend >= 0 ? `+${b.deltaRend.toFixed(2)}` : b.deltaRend.toFixed(2);
        const mn = (b.margenNetoActual * 100).toFixed(2);
        const marca = b.entidad === ctx.entidadPropia ? " ← ENTIDAD PROPIA" : "";
        return `| ${b.entidad.padEnd(30)} | ${pe.padStart(7)} pp | ${rend.padStart(7)} pp | ${mn.padStart(6)}%${marca} |`;
      })
      .join("\n");

    const bloqueWaterfallYoY = waterfallYoY
      ? formatWaterfallTabla(waterfallYoY, ctx.entidadPropia)
      : "";
    const bloqueWaterfallVsDic = waterfallVsDic
      ? formatWaterfallTabla(waterfallVsDic, ctx.entidadPropia)
      : "";

    const user = `# Analisis Margen Neto — ${ctx.periodoLabel} vs ${ctx.periodoAnteriorLabel}

Cliente objetivo (ENTIDAD PROPIA): ${ctx.entidadPropia}
Grupo comparable (${ctx.peerGroup.length} entidades incluida la propia): ${ctx.peerGroup.join(", ")}

## Foto del grupo — Margen Neto actual y variacion en 12 meses
| Entidad                        | Δ PE    | Δ Rend  | %MN act |
|--------------------------------|---------|---------|---------|
${tablaBubbles}

Referencia: promedio del grupo = ${(promedio * 100).toFixed(2)}%. Rango ${(mnMin * 100).toFixed(2)}% — ${(mnMax * 100).toFixed(2)}%.

${bloqueWaterfallYoY}

${bloqueWaterfallVsDic}

INSTRUCCIONES ESPECIFICAS DE ESTA SECCION:
- USA la cascada (waterfall) para explicar POR QUE se movio el margen — no digas solo cuanto se movio. Ejemplo: "el margen de ${ctx.entidadPropia} subio +40 bps: +25 bps por menor costo de fondeo, +30 bps por mejor rendimiento, -15 bps por mayor provisiones".
- Compara la cascada de la ENTIDAD PROPIA vs la de los mejores/peores del grupo — quien esta mejorando por eficiencia (motor sano) vs quien esta mejorando por menores provisiones (motor coyuntural que puede revertir).
- Si hay ambas cascadas (12m y vs Diciembre), CONTRASTA — si el margen mejoro en 12m pero cayo vs Diciembre, hay un tema reciente que resolver.
- Distingue: mejora estructural (eficiencia baja de forma sostenida) vs mejora coyuntural (provisiones bajaron por reduccion temporal de CAR).
- Cada bullet debe cerrar en **Implica:**, **Accion:**, **Riesgo:** u **Oportunidad:**.
- Menciona TODAS las ${ctx.peerGroup.length} entidades.

Output: 5-7 bullets JSON array. Nada mas.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
