/**
 * Prompt "Mora visual" — articulo data-driven con line chart embebido.
 *
 * Diferencia clave vs los otros prompts: el LLM RECIBE la data del chart
 * en formato tabular Y sabe que el chart se insertara en un slot fijo del
 * markdown via placeholder `[[CHART:chart-mora]]`. La prosa integra la
 * lectura del chart en su narrativa.
 *
 * Contexto esperado en ctx.contexto:
 *   moraChartData: string  -- tabla markdown de la data (via chartDataToMarkdown)
 *   moraChartCaption: string  -- ej "Mora global mensual, ultimos 24 meses"
 *   ranking: Array<{ entidad: string; pctMoraActual: number }>
 *   entidadPropiaMoraActual: number
 *   liderMenorMora: { entidad: string; valor: number }
 *   peorMayorMora: { entidad: string; valor: number }
 *   variacion12m: Array<{ entidad: string; delta: number }>  -- puntos bps
 */

import {
  PUBLICACION_SYSTEM_PROMPT,
  type PublicacionPromptTemplate,
} from "./base";
import type { PublicacionPromptContext } from "../types";

type MoraRankRow = { entidad: string; pctMoraActual: number };
type MoraVariacionRow = { entidad: string; delta: number };
type LiderPeor = { entidad: string; valor: number };

export const promptMoraVisual: PublicacionPromptTemplate = {
  version: "v1",
  tema: "mora_visual",
  hashtagsDefault: [
    "#Mora",
    "#RiesgoCrediticio",
    "#SistemaFinancieroPeruano",
    "#SBS",
    "#Microfinanzas",
  ],
  build(ctx: PublicacionPromptContext): { system: string; user: string } {
    const contexto = ctx.contexto as {
      moraChartData?: string;
      moraChartCaption?: string;
      ranking?: MoraRankRow[];
      entidadPropiaMoraActual?: number;
      liderMenorMora?: LiderPeor;
      peorMayorMora?: LiderPeor;
      variacion12m?: MoraVariacionRow[];
    };

    const ranking = contexto.ranking ?? [];
    const rankingLines = ranking
      .map((r, i) => `${i + 1}. ${r.entidad}: ${r.pctMoraActual.toFixed(2)}%`)
      .join("\n");

    const variacionLines = (contexto.variacion12m ?? [])
      .map((v) => {
        const signo = v.delta >= 0 ? "+" : "";
        return `- ${v.entidad}: ${signo}${(v.delta * 100).toFixed(0)} pbs`;
      })
      .join("\n");

    const user = `# ARTICULO: Radiografia de mora del grupo comparable — Cierre ${ctx.periodoLabel}

## Contexto editorial
Cliente objetivo: ${ctx.entidadPropia}
Grupo comparable (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}
Periodo de cierre: ${ctx.periodoLabel}

## Data del cierre
${contexto.moraChartData ?? "(sin data de mora)"}

## Ranking actual por mora global (menor mora = mejor)
${rankingLines || "(sin ranking)"}

## Variacion 12 meses (puntos base, positivo = empeoro)
${variacionLines || "(sin variacion)"}

## Referencias del grupo
- Lider (menor mora): ${contexto.liderMenorMora?.entidad ?? "—"} con ${contexto.liderMenorMora?.valor?.toFixed(2) ?? "—"}%
- Rezagado (mayor mora): ${contexto.peorMayorMora?.entidad ?? "—"} con ${contexto.peorMayorMora?.valor?.toFixed(2) ?? "—"}%
- Entidad propia (${ctx.entidadPropia}): ${contexto.entidadPropiaMoraActual?.toFixed(2) ?? "—"}%

## PLACEHOLDER DEL CHART

En el markdown que devuelvas, incluye EXACTAMENTE una vez la linea:

    [[CHART:chart-mora]]

Ubicala DESPUES de la apertura y ANTES de la primera seccion analitica, en su propia linea (parrafo aparte). El chart es un line chart mensual de los ultimos 24 meses con las ${ctx.peerGroup.length + 1} entidades, entidad propia destacada. La UI lo renderizara automaticamente al pintar el articulo.

## INSTRUCCIONES ESPECIFICAS PARA ESTE ARTICULO

ANGULO EDITORIAL: la mora es la señal de salud crediticia. Un articulo NYT sobre mora responde 3 preguntas: (1) donde estan hoy, (2) hacia donde van (trayectoria), (3) que significa para el negocio. NO listar los numeros — hay que interpretar.

ESTRUCTURA sugerida:
- **Titulo**: enfoque causal + insight. Ej: "La mora del sistema microfinanciero al cierre ${ctx.periodoLabel}: ${contexto.liderMenorMora?.entidad ?? "quien"} contiene mientras el promedio se deteriora"
- **Apertura** (2 parrafos, ~90 palabras): cifra impactante del cierre + tension. Menciona la variacion 12m mas notable del grupo.
- **[[CHART:chart-mora]]** — aca va el placeholder. Solo pon la linea, nada mas.
- **📊 Seccion 1 — Lectura del chart**: prosa que INTERPRETA el line chart. Contrasta la trayectoria de la entidad propia vs el mejor y peor. Menciona quiebres visibles (subidas/bajadas abruptas de +50 pbs en meses concretos si los detectas).
- **⚠️ Seccion 2 — Que significa el ranking actual**: analiza el orden final. Distingue entidades con "mora alta pero bajando" vs "mora baja pero subiendo" (es diferente calidad).
- **💡 Seccion 3 — Que hacer**: implicancia operativa para ${ctx.entidadPropia}. Si esta liderando (menor mora), como mantenerlo. Si esta rezagada, palancas concretas (originacion mas conservadora, refuerzo de cobranza, provisiones anticipatorias).
- **Cierre** (1 parrafo): sintesis + pregunta retadora al lector CFO. Cita opcional: "la SBS viene monitoreando el deterioro de cartera atrasada del sector microfinanciero..." (solo si tiene sentido).

Prosa continua, subtitulos con emoji + titulo, bold moderado en cifras clave, cero bullets en el cuerpo. El chart NO se describe visualmente ("como se ve en el chart") — se INTERPRETA ("la trayectoria de X muestra que...").

Output: JSON exacto con {titulo, contenidoMd, hashtags} — nada mas. En contenidoMd asegurate de incluir [[CHART:chart-mora]] una y solo una vez.`;

    return { system: PUBLICACION_SYSTEM_PROMPT, user };
  },
};
