/**
 * Prompt template para "Calidad de Cartera — Mora Global" — analiza
 * tendencia (MoM + YoY + serie 5 puntos) de la mora vs los otros del grupo.
 *
 * Contexto esperado en ctx.contexto:
 *   serie: Array<{
 *     entidad: string;
 *     moraActual: number;               // % actual (0-1)
 *     moraAnioPrev: number;             // % mismo mes ano anterior
 *     moraMesPrev: number;              // % mes previo inmediato
 *     deltaYoYPp: number;               // pp variacion 12 meses
 *     deltaMoMPp: number;               // pp variacion vs mes previo
 *     serie5Puntos: Array<{ periodo: string; valor: number | null }>;
 *   }>
 */

import { SYSTEM_PROMPT_BASE, type PromptTemplate } from "./base";
import type { PromptContext } from "../types";

type MoraRow = {
  entidad: string;
  moraActual: number;
  moraAnioPrev: number;
  moraMesPrev?: number;
  deltaYoYPp?: number;
  deltaMoMPp?: number;
  deltaPp?: number; // legacy fallback
  conVentaCartera?: number;
  serie5Puntos?: Array<{ periodo: string; valor: number | null }>;
};

export const promptMoraGlobal: PromptTemplate = {
  version: "v4",
  seccion: "mora_global",
  build(ctx: PromptContext): { system: string; user: string } {
    const serie = (ctx.contexto.serie ?? []) as MoraRow[];

    const sortedByMora = [...serie].sort((a, b) => a.moraActual - b.moraActual);
    const promedio = serie.length > 0
      ? serie.reduce((sum, r) => sum + r.moraActual, 0) / serie.length
      : 0;
    const mejorMora = sortedByMora[0]?.moraActual ?? 0;
    const peorMora = sortedByMora[sortedByMora.length - 1]?.moraActual ?? 0;

    const tabla = serie
      .map((r) => {
        const act = (r.moraActual * 100).toFixed(2);
        const prev = (r.moraAnioPrev * 100).toFixed(2);
        const mesPrev = r.moraMesPrev != null ? (r.moraMesPrev * 100).toFixed(2) : "—";
        const yoy = r.deltaYoYPp ?? r.deltaPp ?? 0;
        const yoyStr = yoy >= 0 ? `+${yoy.toFixed(2)}` : yoy.toFixed(2);
        const mom = r.deltaMoMPp ?? 0;
        const momStr = mom >= 0 ? `+${mom.toFixed(2)}` : mom.toFixed(2);
        const marca = r.entidad === ctx.entidadPropia ? " ← PROPIA" : "";
        return `| ${r.entidad.padEnd(28)} | ${act.padStart(6)}% | ${prev.padStart(6)}% | ${mesPrev.padStart(6)}% | ${yoyStr.padStart(7)} pp | ${momStr.padStart(7)} pp${marca} |`;
      })
      .join("\n");

    const tablaSerie = serie
      .filter((r) => r.serie5Puntos && r.serie5Puntos.length > 0)
      .map((r) => {
        const marca = r.entidad === ctx.entidadPropia ? " [PROPIA]" : "";
        const puntos = r.serie5Puntos!
          .map((p) => `${p.periodo}: ${p.valor != null ? (p.valor * 100).toFixed(2) + "%" : "—"}`)
          .join(" → ");
        return `- ${r.entidad}${marca}: ${puntos}`;
      })
      .join("\n");

    const user = `# Calidad de Cartera — Mora Global ${ctx.periodoLabel}

Cliente objetivo (ENTIDAD PROPIA): ${ctx.entidadPropia}
Grupo comparable (${ctx.peerGroup.length} entidades incluida la propia): ${ctx.peerGroup.join(", ")}

## Mora Global actual, hace 12 meses, mes previo, variaciones (% cartera atrasada / cartera bruta)
| Entidad                      | Actual | 12m at | Mes at | Var 12m  | Var mes |
|------------------------------|--------|--------|--------|----------|---------|
${tabla}

Referencia del grupo:
- Mejor mora del grupo: ${(mejorMora * 100).toFixed(2)}%
- Peor mora del grupo: ${(peorMora * 100).toFixed(2)}%
- Promedio del grupo: ${(promedio * 100).toFixed(2)}%
- Rango de dispersion: ${((peorMora - mejorMora) * 100).toFixed(2)} pp

## Serie de 5 periodos por entidad (para ver deterioro sostenido vs coyuntural)
${tablaSerie}

INSTRUCCIONES ESPECIFICAS DE ESTA SECCION:
- Distingue deterioro SOSTENIDO (mora subio los 5 periodos) de deterioro COYUNTURAL (subio solo el ultimo mes). Usa la serie de 5.
- Contrasta variacion 12m vs variacion del mes: si la mora sube +0.5 pp en 12m pero -0.1 pp en el mes, hay estabilizacion reciente — RECONOCELO como señal positiva.
- Al reves: si la variacion mensual es abrupta (>0.3 pp en un solo mes) es una señal de alerta que no aparece en la variacion 12m.
- CAUSA hipotesis a mencionar (segun contexto Peru): crisis social zona sur, El Niño, ciclo electoral, campaña de castigos, cambio de politica de originacion.
- La ENTIDAD PROPIA vs el grupo: cuantifica la brecha en pp (por encima o debajo del promedio). Si la propia mejora pero el grupo mejora mas, esta perdiendo posicion relativa.
- Riesgo sistemico: si >50% del grupo deteriora en el mismo periodo, hay tema sectorial (macro, regulatorio, climatico).
- Cada bullet debe cerrar en **Implica:**, **Accion:**, **Riesgo:** u **Oportunidad:** (ej. "Accion: acelerar castigos de cosechas 2024" o "Riesgo: si continua ritmo actual, mora terminaria 2026 en X%").
- Menciona TODAS las ${ctx.peerGroup.length} entidades.

Output: 5-7 bullets JSON array. Nada mas.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
