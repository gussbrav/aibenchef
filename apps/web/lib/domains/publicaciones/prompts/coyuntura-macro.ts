/**
 * Prompt template: "Coyuntura macro" — articulo que conecta la data del
 * cierre con eventos macro relevantes al periodo (El Niño, tasas BCRP,
 * elecciones, cambios regulatorios SBS). Estilo editorial financiero peruano.
 *
 * Contexto esperado en ctx.contexto:
 *   entidades: Array<{ ...misma shape que benchmarking }>
 *   eventosMacro?: string  // opcional, texto libre con eventos que el
 *                            user quiere que el articulo mencione. Si
 *                            no viene, el LLM usa contexto general del
 *                            periodo (con cuidado — sin especular).
 */

import {
  PUBLICACION_SYSTEM_PROMPT,
  type PublicacionPromptTemplate,
} from "./base";
import type { PublicacionPromptContext } from "../types";

type PERow = {
  entidad: string;
  rendimiento: number;
  otros: number;
  gastoFinanciero: number;
  costoProvision: number;
  gastosOp: number;
  margenAntesImpuestos: number;
  puntoEquilibrio: number;
};

export const promptCoyunturaMacro: PublicacionPromptTemplate = {
  version: "v2-chart",
  tema: "coyuntura_macro",
  hashtagsDefault: [
    "#SistemaFinancieroPeruano",
    "#Coyuntura",
    "#GestionDeRiesgo",
    "#SBS",
    "#BCRP",
  ],
  build(ctx: PublicacionPromptContext): { system: string; user: string } {
    const entidades = (ctx.contexto.entidades ?? []) as PERow[];
    const eventosMacro = (ctx.contexto.eventosMacro ?? "") as string;

    const fmt = (v: number) => (v * 100).toFixed(2);
    const fmtSigned = (v: number) => {
      const s = (v * 100).toFixed(2);
      return v >= 0 ? `+${s}` : s;
    };

    const tabla = entidades
      .map((e) => {
        const marca = e.entidad === ctx.entidadPropia ? " ← ENTIDAD PROPIA" : "";
        return `| ${e.entidad.padEnd(28)} | ${fmt(e.rendimiento).padStart(6)}% | ${fmtSigned(e.gastoFinanciero).padStart(7)}% | ${fmtSigned(e.costoProvision).padStart(7)}% | ${fmtSigned(e.margenAntesImpuestos).padStart(7)}% |${marca}`;
      })
      .join("\n");

    const eventosBloque = eventosMacro
      ? `## Eventos macro que el usuario quiere destacar:\n${eventosMacro}`
      : "## Contexto macro:\nNo hay eventos especificos declarados. Usa SOLO contexto general del cierre y evita especular. Si mencionas algo macro (tasas BCRP, coyuntura politica, eventos climaticos), debe estar vinculado directamente a un numero de la tabla — sin especulacion pura.";

    const user = `# ARTICULO: Coyuntura macro y su impacto en el sistema — Cierre ${ctx.periodoLabel}

## Contexto del articulo
Cliente objetivo: ${ctx.entidadPropia}
Grupo comparable (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}

## Data del cierre (% sobre cartera promedio TTM)
| Entidad                       | Rendim | GastoFin| Provis  | Margen  |
|-------------------------------|--------|---------|---------|---------|
${tabla}

${eventosBloque}

## INSTRUCCIONES ESPECIFICAS PARA ESTE ARTICULO:

REFERENTE ESTILISTICO PRINCIPAL: Hermes A. Holguin ("El Niño 2026-2027 y su impacto en el Sistema Financiero"). Su patron:
- Titulo con tension causal + pregunta implicita.
- Apertura: contexto factual (SBS, ENFEN, BCRP, OSDN) con cifras oficiales.
- Seccion "Tres episodios, una misma leccion" (📊): historia comparada — como respondio el sistema en crisis anteriores similares.
- Seccion "Las microfinanzas en el sistema financiero" (⚠️): quien esta mas expuesto y por que — con cifras SBS del cierre.
- Seccion "Postura de la SBS" (🏛️): cita al superintendente o publicacion oficial (SOLO si el user te dio el dato en eventosMacro — nunca inventes citas).
- Seccion "A priorizar" (✅): 3-5 recomendaciones operativas, cada una un parrafo corto (SIN listas numeradas — prosa continua con conectores "Primero, ...", "Ademas, ...", "Finalmente, ...").
- Cierre: sintesis en 1 linea + call-to-action potente. Ej: "El Niño no se puede evitar, pero si la magnitud de su impacto en la cartera crediticia."

## PLACEHOLDER DEL CHART

En el markdown que devuelvas, incluye EXACTAMENTE una vez la linea:

    [[CHART:chart-ranking-margen]]

Ubicala DESPUES de la apertura y ANTES de la primera seccion analitica, en su propia linea (parrafo aparte). El chart es un bar chart horizontal con el ranking del margen neto del grupo al cierre analizado. La UI lo renderizara automaticamente.

ESTRUCTURA sugerida:
- **Titulo**: tension causal (evento macro + sistema). Ej: "El Niño 2026-2027 y las cajas municipales: aprendizajes de 2017 y 2023"
- **Apertura**: cifras oficiales + hook.
- **[[CHART:chart-ranking-margen]]** — aca va el placeholder. Solo pon la linea.
- **Seccion 1 — 📊 [Historia o comparativo]** — INTERPRETA el chart (no lo describas visualmente).
- **Seccion 2 — ⚠️ [Exposicion actual del grupo]**
- **Seccion 3 — 🏛️ [Regulacion o postura autoridad]** (solo si tienes el dato en el input)
- **Seccion 4 — ✅ A priorizar** (recomendaciones en prosa)
- **Cierre**

REGLAS DURAS PARA COYUNTURA:
- Si mencionas El Niño, tasas BCRP, elecciones, cambios SBS — SOLO si el input eventosMacro los declara O si vienen implicitos por el periodo del cierre. Cero especulacion politica.
- Nunca inventes citas de autoridades (superintendente, BCRP, ministro). Si el user no te dio la cita en el input, no la incluyas.
- Toda mencion macro debe estar VINCULADA a un numero de la tabla: "la mora del grupo esta en X%, cifra que refleja el impacto del evento Y descrito en el input".
- Menciona TODAS las entidades del grupo al menos una vez.

Output: JSON exacto con {titulo, contenidoMd, hashtags} — nada mas. En contenidoMd asegurate de incluir [[CHART:chart-ranking-margen]] una y solo una vez.`;

    return { system: PUBLICACION_SYSTEM_PROMPT, user };
  },
};
