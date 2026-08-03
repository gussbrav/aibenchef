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
  version: "v1",
  seccion: "cartera_bruta",
  build(ctx: PromptContext): { system: string; user: string } {
    const serie = (ctx.contexto.serie ?? []) as CarteraRow[];
    const tabla = serie
      .map((r) => {
        const act = r.valorActual.toLocaleString("es-PE", { maximumFractionDigits: 0 });
        const prev = r.valorAnioPrev.toLocaleString("es-PE", { maximumFractionDigits: 0 });
        const g = (r.crecimientoPct * 100).toFixed(1);
        return `| ${r.entidad.padEnd(30)} | ${act.padStart(12)} | ${prev.padStart(12)} | ${g.padStart(6)}% |`;
      })
      .join("\n");

    const user = `# Cartera Bruta — evolucion ${ctx.periodoAnteriorLabel} → ${ctx.periodoLabel}

Cliente: ${ctx.entidadPropia}
Peer group: ${ctx.peerGroup.join(", ")}

Cartera Bruta (MM S/) y crecimiento anual:
| Entidad                        | Actual (MM)  | Ano prev (MM)| Crec % |
|--------------------------------|--------------|--------------|--------|
${tabla}

Genera 3-5 bullets ejecutivos:
- Posicion relativa de ${ctx.entidadPropia} en tamaño (rango dentro del peer).
- Ganador y perdedor del crecimiento en el peer group. Cuantificar el gap.
- Si ${ctx.entidadPropia} crece mas o menos que la mediana del peer: por que puede ser.
- Si algun peer muestra crecimiento anomalo (muy alto o negativo), destacarlo con hipotesis.

Devolver SOLO el JSON array de strings.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
