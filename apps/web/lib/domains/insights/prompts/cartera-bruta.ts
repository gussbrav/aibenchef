/**
 * Prompt template para "Cartera Bruta" — analiza tendencia de tamaño,
 * crecimiento y velocidad (MoM + YoY) vs los otros del grupo.
 *
 * Contexto esperado en ctx.contexto:
 *   serie: Array<{
 *     entidad: string;
 *     valorActual: number;              // MM S/ periodo actual
 *     valorAnioPrev: number;            // MM S/ mismo mes ano anterior
 *     valorMesPrev: number;             // MM S/ mes previo (o cierre inmediato)
 *     crecimientoYoYPct: number;        // % variacion 12 meses
 *     crecimientoMoMPct: number;        // % variacion vs periodo previo inmediato
 *     serie5Puntos: Array<{ periodo: string; valor: number | null }>;
 *   }>
 */

import { SYSTEM_PROMPT_BASE, type PromptTemplate } from "./base";
import type { PromptContext } from "../types";

type CarteraRow = {
  entidad: string;
  valorActual: number;
  valorAnioPrev: number;
  valorMesPrev?: number;
  crecimientoYoYPct?: number;
  crecimientoMoMPct?: number;
  crecimientoPct?: number; // legacy fallback
  serie5Puntos?: Array<{ periodo: string; valor: number | null }>;
};

export const promptCarteraBruta: PromptTemplate = {
  version: "v5",
  seccion: "cartera_bruta",
  build(ctx: PromptContext): { system: string; user: string } {
    const serie = (ctx.contexto.serie ?? []) as CarteraRow[];

    // Ranking y stats para dar contexto de posicionamiento
    const sortedByCartera = [...serie].sort((a, b) => b.valorActual - a.valorActual);
    const totalGrupo = serie.reduce((sum, r) => sum + r.valorActual, 0);
    const promedio = serie.length > 0 ? totalGrupo / serie.length : 0;
    const promedioYoY = serie.length > 0
      ? serie.reduce((sum, r) => sum + (r.crecimientoYoYPct ?? r.crecimientoPct ?? 0), 0) / serie.length
      : 0;

    const tabla = sortedByCartera
      .map((r, idx) => {
        const act = r.valorActual.toLocaleString("es-PE", { maximumFractionDigits: 0 });
        const prev = r.valorAnioPrev.toLocaleString("es-PE", { maximumFractionDigits: 0 });
        const gYoY = (r.crecimientoYoYPct ?? r.crecimientoPct ?? 0) * 100;
        const gYoYStr = gYoY >= 0 ? `+${gYoY.toFixed(1)}` : gYoY.toFixed(1);
        const gMoM = (r.crecimientoMoMPct ?? 0) * 100;
        const gMoMStr = gMoM >= 0 ? `+${gMoM.toFixed(1)}` : gMoM.toFixed(1);
        const share = totalGrupo > 0 ? ((r.valorActual / totalGrupo) * 100).toFixed(1) : "0.0";
        const marca = r.entidad === ctx.entidadPropia ? " ← PROPIA" : "";
        return `| ${(idx + 1).toString().padStart(2)} | ${r.entidad.padEnd(28)} | ${act.padStart(12)} | ${prev.padStart(12)} | ${gYoYStr.padStart(6)}% | ${gMoMStr.padStart(6)}% | ${share.padStart(4)}%${marca} |`;
      })
      .join("\n");

    const tablaSerie = serie
      .filter((r) => r.serie5Puntos && r.serie5Puntos.length > 0)
      .map((r) => {
        const marca = r.entidad === ctx.entidadPropia ? " [PROPIA]" : "";
        const puntos = r.serie5Puntos!
          .map((p) => `${p.periodo}: ${p.valor != null ? p.valor.toLocaleString("es-PE", { maximumFractionDigits: 0 }) : "—"}`)
          .join(" → ");
        return `- ${r.entidad}${marca}: ${puntos}`;
      })
      .join("\n");

    const user = `# Cartera Bruta — foto ${ctx.periodoLabel} y evolucion

Cliente objetivo (ENTIDAD PROPIA): ${ctx.entidadPropia}
Grupo comparable (${ctx.peerGroup.length} entidades incluida la propia): ${ctx.peerGroup.join(", ")}

## Ranking por tamaño con crecimiento en 12 meses y vs mes anterior (MM S/)
| #  | Entidad                      | Actual (MM)  | 12m atras (MM)| 12m %  | Mes %  | Share |
|----|------------------------------|--------------|---------------|--------|--------|-------|
${tabla}

Referencia del grupo:
- Cartera total del grupo: ${totalGrupo.toLocaleString("es-PE", { maximumFractionDigits: 0 })} MM S/
- Promedio de cartera por entidad: ${promedio.toLocaleString("es-PE", { maximumFractionDigits: 0 })} MM S/
- Promedio de crecimiento 12m: ${(promedioYoY * 100).toFixed(1)}%

## Serie de 5 periodos por entidad (para ver aceleracion/desaceleracion)
${tablaSerie}

INSTRUCCIONES ESPECIFICAS DE ESTA SECCION:
- Diferencia crecimiento SOSTENIDO (crecio los 5 periodos de la serie) de crecimiento COYUNTURAL (subio solo el ultimo). Mira la serie de 5 puntos.
- ¿La velocidad de crecimiento MENSUAL de la entidad propia esta acelerando o desacelerando vs la de hace 12 meses? Usa la comparacion Mes % vs 12m %.
- Contraste PROPIA vs los otros: si el grupo crece 8% en 12m y la propia crece 3%, esta perdiendo participacion — CUANTIFICA en pp de share perdidos.
- Sostenibilidad: crecimientos >20% anuales requieren mencion de riesgo (calidad de cartera puede deteriorarse — se necesita mirar mora en paralelo).
- Crecimientos negativos: distingue estrategico (limpieza de portafolio, salida de segmentos) vs preocupante (perdida de negocio, competencia).
- Cada bullet debe cerrar en **Implica:**, **Accion:**, **Riesgo:** u **Oportunidad:**.
- Menciona TODAS las ${ctx.peerGroup.length} entidades del grupo.

Output: 5-7 bullets JSON array. Nada mas.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
