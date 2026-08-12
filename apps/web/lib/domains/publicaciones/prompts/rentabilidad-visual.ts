/**
 * Prompt "Rentabilidad visual" — articulo con line chart (ROE anual) +
 * bar chart (ranking del cierre) embebidos.
 *
 * Contexto esperado en ctx.contexto:
 *   roeChartData: string  -- tabla markdown del ROE anual
 *   roeRankingChartData: string  -- tabla del ranking del cierre
 *   ranking: Array<{ entidad: string; roeActual: number }>
 *   entidadPropiaRoeActual: number
 *   liderRoe: { entidad: string; valor: number }
 *   peorRoe: { entidad: string; valor: number }
 */

import {
  PUBLICACION_SYSTEM_PROMPT,
  type PublicacionPromptTemplate,
} from "./base";
import type { PublicacionPromptContext } from "../types";

type Ranked = { entidad: string; roeActual: number };
type LiderPeor = { entidad: string; valor: number };

export const promptRentabilidadVisual: PublicacionPromptTemplate = {
  version: "v1",
  tema: "rentabilidad_visual",
  hashtagsDefault: [
    "#Rentabilidad",
    "#ROE",
    "#SistemaFinancieroPeruano",
    "#Microfinanzas",
    "#GestionFinanciera",
  ],
  build(ctx: PublicacionPromptContext): { system: string; user: string } {
    const contexto = ctx.contexto as {
      roeChartData?: string;
      roeRankingChartData?: string;
      ranking?: Ranked[];
      entidadPropiaRoeActual?: number;
      liderRoe?: LiderPeor;
      peorRoe?: LiderPeor;
    };

    const ranking = contexto.ranking ?? [];
    const rankingLines = ranking
      .map((r, i) => `${i + 1}. ${r.entidad}: ROE ${r.roeActual.toFixed(2)}%`)
      .join("\n");

    const user = `# ARTICULO: Rentabilidad patrimonial del grupo comparable — Cierre ${ctx.periodoLabel}

## Contexto editorial
Cliente objetivo: ${ctx.entidadPropia}
Grupo comparable (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}
Periodo de cierre: ${ctx.periodoLabel}

## Data — Evolucion anual del ROE (ultimos 5 cierres)
${contexto.roeChartData ?? "(sin data)"}

## Data — Ranking actual del cierre
${contexto.roeRankingChartData ?? "(sin data)"}

## Ranking numerico
${rankingLines || "(sin ranking)"}

## Referencias del grupo
- Lider ROE: ${contexto.liderRoe?.entidad ?? "—"} con ${contexto.liderRoe?.valor?.toFixed(2) ?? "—"}%
- Rezagado ROE: ${contexto.peorRoe?.entidad ?? "—"} con ${contexto.peorRoe?.valor?.toFixed(2) ?? "—"}%
- Entidad propia (${ctx.entidadPropia}): ${contexto.entidadPropiaRoeActual?.toFixed(2) ?? "—"}%

## PLACEHOLDERS DE CHARTS

En el markdown debes incluir EXACTAMENTE dos placeholders, cada uno en su propia linea:

    [[CHART:chart-roe-historico]]      <- line chart ROE anual, 5 cierres
    [[CHART:chart-roe-ranking]]        <- bar chart ranking del cierre actual

Ubicacion sugerida:
- [[CHART:chart-roe-historico]] DESPUES de la apertura, antes de la Seccion 1
- [[CHART:chart-roe-ranking]] antes de la Seccion 3 o del cierre

## INSTRUCCIONES ESPECIFICAS PARA ESTE ARTICULO

ANGULO EDITORIAL: la rentabilidad es lo que atrae capital. Un articulo periodistico serio sobre ROE responde: (1) quien esta rentabilizando mejor SU capital, (2) es sostenible la trayectoria, (3) que puede hacer ${ctx.entidadPropia} para acercarse al lider.

ESTRUCTURA sugerida:
- **Titulo**: enfoque causal + insight. Ej: "El ROE del segmento al cierre ${ctx.periodoLabel}: ${contexto.liderRoe?.entidad ?? "quien"} sostiene rentabilidad mientras el promedio se contrae"
- **Apertura** (2 parrafos, ~90 palabras): cifra del lider + tension. Menciona la variacion 5 años del ROE mas notable.
- **[[CHART:chart-roe-historico]]** — line chart de evolucion.
- **📊 Seccion 1 — Trayectoria del ROE en 5 cierres**: prosa que interpreta el line chart. Distingue "ROE alto y estable" (mejor calidad) vs "ROE alto pero volatil" (mas fragil). Menciona quiebres de tendencia visibles.
- **⚠️ Seccion 2 — Que pasa con la entidad propia**: como se posiciona ${ctx.entidadPropia} vs el lider y el promedio del grupo. Diagnostico honesto.
- **[[CHART:chart-roe-ranking]]** — bar chart del cierre.
- **💡 Seccion 3 — El ranking del cierre**: analiza el orden del cierre actual. Identifica quien esta "sobre la mediana" vs "bajo la mediana". Contrasta con el ranking historico.
- **🎯 Cierre (Que hacer)**: palancas concretas para ${ctx.entidadPropia}. Si esta liderando, como sostenerlo (calidad de originacion, control de costo operativo, gestion de spread). Si esta rezagada, palancas de mejora priorizadas.

Prosa continua, cero bullets en el cuerpo. El chart NO se describe visualmente — se INTERPRETA. Bold moderado (3-6 por articulo) en cifras clave y nombres de entidades destacadas.

Output: JSON exacto con {titulo, contenidoMd, hashtags} — nada mas. En contenidoMd asegurate de incluir AMBOS placeholders exactamente una vez cada uno.`;

    return { system: PUBLICACION_SYSTEM_PROMPT, user };
  },
};
