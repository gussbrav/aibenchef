/**
 * Research service del macro context — investiga el estado macro vigente
 * del sistema financiero peruano via Claude + web_search y lo persiste
 * en gov.macro_context.
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { getProviderApiKey } from "@/lib/domains/ai-providers";
import type {
  MacroCategoria,
  MacroResearchItem,
  MacroResearchResult,
  MacroSeveridad,
} from "./types";

const RESEARCH_MODEL = "claude-sonnet-4-5-20250929";
const RESEARCH_PRICING = {
  input: 3.0,
  output: 15.0,
  webSearchPerQuery: 0.01,
};
const MAX_WEB_SEARCH_QUERIES = 10;

export class MacroResearchError extends Error {
  constructor(
    message: string,
    public readonly code: "no_api_key" | "api_error" | "parse_error",
  ) {
    super(message);
    this.name = "MacroResearchError";
  }
}

const SYSTEM_PROMPT = `Eres un analista macroeconomico senior enfocado en el sistema financiero peruano. Tu trabajo es producir un snapshot estructurado del contexto macro VIGENTE que afecta las decisiones de credito y provisiones de las entidades financieras del Peru.

**FUENTES OFICIALES OBLIGATORIAS — priorizar en este orden:**
1. SBS (sbs.gob.pe) para circulares, normativa, estadisticas del sistema financiero
2. BCR (bcrp.gob.pe) para tasa de referencia, inflacion, PBI
3. INEI (inei.gob.pe) para indicadores macro oficiales
4. MEF (gob.pe/mef) para politica fiscal, Reactiva, FAE, Impulso MyPeru
5. INDECI o COEN (indeci.gob.pe) para emergencias climaticas, Niño, declaratorias
6. ONPE / JNE (onpe.gob.pe, jne.gob.pe) para ciclo electoral
7. Prensa financiera peruana seria (Gestion, Semana Economica, El Comercio opinion economica)

Las fuentes sin dominio .gob.pe o sin autoridad financiera reconocida SE EVITAN. Un item sin al menos UNA fuente oficial verificable NO va al output — mejor devolver menos items pero todos solidos.

Usa web_search para traer la data mas actualizada que puedas sobre:

CATEGORIAS A INVESTIGAR:
1. **climatico** — Fenomeno El Niño en curso 2026 (estado actual, distritos declarados en emergencia por el gobierno, severidad proyectada), friajes, inundaciones, sequias, cualquier evento climatico que afecte cartera microempresa, agraria o rural.
2. **macro** — Tasa de referencia BCR actual, inflacion, crecimiento PBI, tipo de cambio, remesas, cualquier variable macro relevante para el credito.
3. **politico** — Ciclo electoral 2026 (fase, principales candidatos, escenarios), crisis social activa, conflictos politicos que afecten economia.
4. **regulatorio** — Nuevas circulares SBS publicadas en los ultimos 3 meses relevantes para el sistema financiero (provisiones, capital, etc), cambios normativos recientes (ley de usura, FAE, Reactiva, Impulso MyPeru).
5. **sectorial** — Consolidaciones recientes (CMAC Sullana-Piura, nuevas Financieras autorizadas), eventos del sector financiero peruano.

PARA CADA ITEM RELEVANTE DEVUELVE UN OBJETO CON:
- categoria: una de las 5 arriba
- titulo: nombre corto del evento (ej. "Fenomeno El Niño 2026 en curso")
- resumen: 1-3 oraciones con CIFRAS DURAS (ej. "1,380 distritos en emergencia, 73% del pais. BCR estima ~2% del PBI de impacto negativo.")
- impacto: una oracion sobre que cartera/segmento se ve afectado (ej. "microempresa y agraria mas expuestas; COOPAC y Cajas con exposicion regional norte en mayor riesgo")
- severidad: "alta" | "media" | "baja" | "informativo"
- vigente_hasta: fecha ISO yyyy-mm-dd estimada hasta la que es relevante (si no se puede estimar, null)
- fuentes: 1-3 URLs reales consultadas, al menos una de dominio oficial (.gob.pe o institucion financiera reconocida). URLs de verificacion — tienen que abrir en navegador y mostrar el dato citado.

FORMATO DE SALIDA — JSON ESTRICTO:
{
  "items": [
    {
      "categoria": "climatico",
      "titulo": "...",
      "resumen": "...",
      "impacto": "...",
      "severidad": "alta",
      "vigente_hasta": "2027-03-31",
      "fuentes": ["https://..."]
    },
    ...
  ]
}

REGLAS INVIOLABLES:
- Solo info con FUENTE verificable. Si no encuentras evidencia, no inventes.
- Castellano peruano (tu/tienes/puedes). Sin voseo argentino.
- Preservar la ñ.
- NUNCA citar clasificadoras de riesgo por nombre.
- Prioriza eventos de impacto REAL en decisiones de credito. Omite ruido politico sin consecuencia directa.
- Entre 3 y 10 items total. Menos es mejor si no hay data verificada.
- JSON puro, sin markdown fences, sin texto adicional.`;

/**
 * Strippear las citas <cite index="..."> que Anthropic web_search inserta
 * en los textos. Las fuentes van por separado en el array `fuentes`.
 */
function stripCitations(s: string): string {
  // Anthropic web_search puede devolver las citas con brackets angulares
  // o con parentesis (observado en prod 2026-11-19). Matchear ambos.
  return s
    .replace(/[<(]\s*\/?\s*cite\b[^>)]*[>)]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseResearchJson(text: string): MacroResearchItem[] {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as { items?: unknown };
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const valid: MacroResearchItem[] = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const categoria = r.categoria;
      if (
        categoria !== "climatico" &&
        categoria !== "macro" &&
        categoria !== "politico" &&
        categoria !== "regulatorio" &&
        categoria !== "sectorial"
      ) {
        continue;
      }
      const severidad = r.severidad;
      if (
        severidad !== "alta" &&
        severidad !== "media" &&
        severidad !== "baja" &&
        severidad !== "informativo"
      ) {
        continue;
      }
      if (typeof r.titulo !== "string" || !r.titulo.trim()) continue;
      if (typeof r.resumen !== "string" || !r.resumen.trim()) continue;

      const fuentes = Array.isArray(r.fuentes)
        ? r.fuentes.filter((x): x is string => typeof x === "string" && x.startsWith("http"))
        : [];

      valid.push({
        categoria: categoria as MacroCategoria,
        titulo: stripCitations(r.titulo),
        resumen: stripCitations(r.resumen),
        impacto: typeof r.impacto === "string" ? stripCitations(r.impacto) : null,
        severidad: severidad as MacroSeveridad,
        vigente_hasta: typeof r.vigente_hasta === "string" ? r.vigente_hasta : null,
        fuentes,
      });
    }
    return valid;
  } catch {
    return [];
  }
}

export async function researchMacroContext(): Promise<MacroResearchResult> {
  const apiKey = await getProviderApiKey("claude");
  if (!apiKey) {
    throw new MacroResearchError(
      "No hay API key de Claude configurada. Configurala en /dashboard/settings -> Proveedores AI.",
      "no_api_key",
    );
  }

  const client = new Anthropic({ apiKey });

  const userPrompt = `Investiga el estado actual (${new Date().toISOString().slice(0, 10)}) del contexto macro peruano que impacta las decisiones de credito y provisiones del sistema financiero. Entrega los items relevantes en el formato JSON indicado, con fuentes verificables.`;

  const t0 = Date.now();
  let response: Anthropic.Messages.Message;
  try {
    response = await client.messages.create({
      model: RESEARCH_MODEL,
      max_tokens: 4096,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: MAX_WEB_SEARCH_QUERIES,
        } as unknown as Anthropic.Messages.Tool,
      ],
      messages: [{ role: "user", content: userPrompt }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new MacroResearchError(`Anthropic API error: ${msg}`, "api_error");
  }
  const durationMs = Date.now() - t0;

  const textBlocks = response.content.filter(
    (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
  );
  const lastText = textBlocks.at(-1)?.text ?? "";
  const items = parseResearchJson(lastText);
  if (items.length === 0) {
    throw new MacroResearchError(
      `LLM no devolvio items validos. Raw: ${lastText.slice(0, 300)}`,
      "parse_error",
    );
  }

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const inputCost = (inputTokens / 1_000_000) * RESEARCH_PRICING.input;
  const outputCost = (outputTokens / 1_000_000) * RESEARCH_PRICING.output;
  type ServerToolBlock = { type: "server_tool_use"; name?: string };
  const toolBlocks = (response.content as unknown as Array<ServerToolBlock>).filter(
    (b) => b && b.type === "server_tool_use",
  );
  const webSearchQueries = toolBlocks.filter((b) => b.name === "web_search").length;
  const webSearchCost = webSearchQueries * RESEARCH_PRICING.webSearchPerQuery;
  const totalCost = inputCost + outputCost + webSearchCost;

  return {
    items,
    metadata: {
      model: `${RESEARCH_MODEL} + web_search_20250305`,
      costUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
      inputTokens,
      outputTokens,
      durationMs,
    },
  };
}
