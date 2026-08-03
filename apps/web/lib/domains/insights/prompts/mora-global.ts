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
  version: "v1",
  seccion: "mora_global",
  build(ctx: PromptContext): { system: string; user: string } {
    const serie = (ctx.contexto.serie ?? []) as MoraRow[];
    const tabla = serie
      .map((r) => {
        const act = (r.moraActual * 100).toFixed(2);
        const prev = (r.moraAnioPrev * 100).toFixed(2);
        const d = r.deltaPp.toFixed(2);
        const vc = r.conVentaCartera != null ? (r.conVentaCartera * 100).toFixed(2) + "%" : "—";
        return `| ${r.entidad.padEnd(30)} | ${act.padStart(6)}% | ${prev.padStart(6)}% | ${d.padStart(6)} pp | ${vc.padStart(6)} |`;
      })
      .join("\n");

    const user = `# Calidad de Cartera — Mora Global ${ctx.periodoLabel} vs ${ctx.periodoAnteriorLabel}

Cliente: ${ctx.entidadPropia}
Peer group: ${ctx.peerGroup.join(", ")}

Mora Global (% cartera atrasada / cartera bruta):
| Entidad                        | Actual | Ano prev | Delta   | Con V/C |
|--------------------------------|--------|----------|---------|---------|
${tabla}

Notas:
- Mora Global = Cartera Atrasada / Cartera Bruta. Positivo (aumento) es MALO.
- Con V/C = incluye venta de cartera y castigos del periodo (indicador ajustado).
- Delta positivo = deterioro en la calidad. Negativo = mejora.

Genera 3-5 bullets ejecutivos:
- Posicion de ${ctx.entidadPropia}: mora actual + evolucion anual (mejora/deterioro).
- Cual entidad tuvo la MEJOR evolucion (mayor mejora / menor deterioro). Cual la peor.
- Si algun peer muestra deterioro superior a 1 pp, alerta explicita.
- Si la mora "con venta cartera" difiere mucho de la basica, mencionar (indica que el peer esta limpiando activamente).

Devolver SOLO el JSON array de strings.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
