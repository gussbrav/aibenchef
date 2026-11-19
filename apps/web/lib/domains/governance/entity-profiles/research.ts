/**
 * Research service — investiga una entidad financiera o COOPAC via
 * Claude API con web_search_20250305 tool habilitado. Extrae en JSON
 * estructurado: ubicacion, inicio operaciones, publico objetivo real,
 * modelo de negocio, segmento de cartera, productos principales, fuentes.
 *
 * Fuente de la API key: app.ai_providers (misma tabla que usa el panel
 * /dashboard/settings > "Proveedores AI"). Reusamos la configuracion que
 * ya tiene el proyecto — no agregamos infra nueva.
 *
 * Costo tipico: $0.05-0.15 por entidad (depende de cuantas busquedas
 * haga el tool). Se persiste en gov.entity_profiles.research_cost_usd y
 * en gov.entity_research_daily_usage.total_cost_usd.
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { getProviderApiKey } from "@/lib/domains/ai-providers";
import type {
  EntityProfileResearchResult,
  ModeloNegocio,
  ResearchResult,
} from "./types";

/**
 * Modelo que usa el research. Haiku es demasiado limitado para extraccion
 * rigurosa con web search; Sonnet 4.6 balance calidad/costo. Si quieres
 * degradar a mas barato, cambia aqui.
 */
const RESEARCH_MODEL = "claude-sonnet-4-5-20250929";

/**
 * Pricing USD por 1M tokens del modelo de research. Actualizar si cambia.
 */
const RESEARCH_PRICING = {
  input: 3.0,
  output: 15.0,
  /** Costo por query de web_search (fuera del cobro de tokens). */
  webSearchPerQuery: 0.01,
};

/**
 * Max web searches por research. Mantener bajo para controlar costo —
 * 5 busquedas alcanzan de sobra para una ficha de entidad financiera.
 */
const MAX_WEB_SEARCH_QUERIES = 8;

/**
 * Error del research service. Causa que el enrichment degrade gracefully
 * (sigue sin profile, el prompt v13 declara la falta y sigue).
 */
export class ResearchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "no_api_key"
      | "api_error"
      | "parse_error"
      | "rate_limit"
      | "timeout",
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ResearchError";
  }
}

const SYSTEM_PROMPT = `Eres un investigador financiero senior especializado en el sistema financiero peruano regulado por SBS (bancos, financieras, cajas municipales, cajas rurales, EDPYMES y cooperativas de ahorro y credito).

Tu trabajo es extraer una ficha de perfil FACTUAL sobre una entidad especifica usando web search. No inventes nada — si no encuentras evidencia de un campo, dejalo en null.

PARA CADA CAMPO BUSCA EN:
- Facebook oficial de la entidad (facebook.com/<nombreEntidad>)
- Sitio web propio si existe (dominio tipo cacsanblas.com.pe, coosunat.org.pe, etc.)
- Portal SBS (sbs.gob.pe) para datos regulatorios y Registro SBS COOPAC
- UniversidadPeru.com — tiene fichas empresariales de la mayoria de COOPAC con direccion, RUC, fecha inicio
- Facturalo.pe / SUNAT para verificar RUC y estado tributario
- Prensa financiera peruana (Gestion, Semana Economica, El Comercio)
- Ley 29523 (COOPAC) y relacionadas para modelo de negocio

**ESTRATEGIA DE BUSQUEDA — hacer AL MENOS 3 queries distintas** para no quedarte con la primera fuente:
1. Primera query: nombre exacto de la entidad + "COOPAC" o "cooperativa"
2. Segunda query: nombre + "clientes" o "prestamos" o "a quien presta"
3. Tercera query: nombre + "facebook" o "web oficial" para traer la propia publicacion de la entidad

**CAMPOS CRITICOS QUE NO PUEDEN QUEDAR VACIOS si hay cualquier fuente publica:**
- **publico_objetivo**: lo que mas importa para el analisis. Busca explicitamente a QUE TIPO DE PERSONAS LES PRESTA. Ejemplos de valores correctos:
  * "Trabajadores del sector publico (trabajador nombrado o contratados CAS) via descuento por planilla y convenios"
  * "Trabajadores de SUNAT ampliado desde 2021 a otras entidades publicas"
  * "Microempresa de Lima Sur, consumo publico general"
  * "Afiliados a gremios de educadores regionales"
  Si la pagina de Facebook / web / prensa menciona "prestamos para CAS", "prestamos para nombrados", "convenios con instituciones", "trabajadores de X institucion" — eso ES el publico_objetivo. No lo dejes como null si hay evidencia.
- **modelo_negocio**: basado en publico_objetivo, deducir cerrada/abierta/mixta.
  * Si presta solo a empleados de UNA institucion -> "cerrada"
  * Si presta a publico general sin vinculo laboral -> "abierta"
  * Si presta a trabajadores del sector publico GENERAL (CAS/nombrado de cualquier entidad, convenios con multiples instituciones) + consumo abierto -> "mixta"
  * Solo "desconocido" si realmente no hay indicacion en ninguna fuente.

CAMPOS A EXTRAER (todos opcionales — null si no encuentras evidencia):
- ubicacion: ciudad y departamento si lo encuentras (ej. "Arequipa, Peru"). Si tiene sucursales en multiples, "nacional" o la sede principal.
- region: departamento normalizado (solo el nombre del departamento peruano: "Arequipa", "Lima", "Cusco", "La Libertad", "Piura", "Puno", "Junin", "Ancash", etc). Si opera en mas de 3 departamentos o es banca multiple sin foco regional, usar "nacional". Diferente de ubicacion que puede tener ciudad y pais — este es solo el depto, estandarizado.
- inicio_operaciones: año o año-mes (ej. "2018-12" o "1995"). Preferir fuente SBS o RUC.
- ruc_sunat: 11 digitos
- publico_objetivo: a quien le prestan de verdad. Ejemplos de valores buenos: "Trabajadores publicos (CAS, nombrado) + convenios", "Microempresa Lima Sur", "Afiliados del gremio X", "Publico general con enfasis en consumo". Si es una COOPAC con nombre institucional (ej. COOSUNAT = SUNAT), dilo. Si es una COOPAC generica sin vinculacion obvia, "publico general" o "comunidad local".
- modelo_negocio: uno de: "cerrada" (vinculo laboral/gremial), "abierta" (publico general), "mixta" (ambos), "desconocido". Preferir evidencia a inferencia.
- segmento_cartera_hipotesis: que tipo de credito domina. Valores comunes: "consumo con descuento planilla", "microempresa retail", "pequeña empresa comercial", "credito grupal", "consumo convenio publico", "hipotecario vivienda".
- productos_principales: lista corta en texto plano, ej. "ahorros, DPF, creditos convenio, creditos consumo".
- notas: 1-3 oraciones adicionales utiles para analizar la entidad (ej. "fundada por trabajadores de X institucion", "mayor COOPAC de Arequipa por activos", "especializada en credito grupal rural").
- fuentes: URLs de las paginas que consultaste para fundamentar los datos. Devolver 2-5 URLs reales.

FORMATO DE SALIDA — JSON ESTRICTO:
{
  "ubicacion": string | null,
  "region": string | null,
  "inicio_operaciones": string | null,
  "ruc_sunat": string | null,
  "publico_objetivo": string | null,
  "modelo_negocio": "cerrada" | "abierta" | "mixta" | "desconocido" | null,
  "segmento_cartera_hipotesis": string | null,
  "productos_principales": string | null,
  "notas": string | null,
  "fuentes": string[]
}

REGLAS INVIOLABLES:
- Solo informacion RASTREABLE a fuentes publicas. Si un dato no esta en ninguna fuente que hayas consultado, es null.
- Castellano peruano (tu/tienes/puedes). Sin voseo argentino.
- Preservar la ñ.
- NUNCA incluir citas marca-registrada ni de clasificadoras.
- JSON puro, sin markdown fences, sin texto adicional.`;

/**
 * Strippear las citas (cite index="..."> que Anthropic web_search inserta
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

/**
 * Extrae el bloque JSON del output del LLM. Tolera preambulo conversacional,
 * markdown fences, o texto posterior. Mismo patron que macro-context.
 */
function extractJsonBlock(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function parseResearchJson(text: string): EntityProfileResearchResult | null {
  const cleaned = extractJsonBlock(text);

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const toStringOrNull = (v: unknown): string | null => {
      if (typeof v !== "string") return null;
      const cleaned = stripCitations(v);
      return cleaned.length > 0 ? cleaned : null;
    };

    const modelo = toStringOrNull(parsed.modelo_negocio);
    const modeloValido: ModeloNegocio | null =
      modelo === "cerrada" || modelo === "abierta" || modelo === "mixta" || modelo === "desconocido"
        ? modelo
        : null;

    const fuentesRaw = parsed.fuentes;
    const fuentes = Array.isArray(fuentesRaw)
      ? fuentesRaw.filter((x): x is string => typeof x === "string" && x.startsWith("http"))
      : [];

    return {
      ubicacion: toStringOrNull(parsed.ubicacion),
      region: toStringOrNull(parsed.region),
      inicioOperaciones: toStringOrNull(parsed.inicio_operaciones),
      rucSunat: toStringOrNull(parsed.ruc_sunat),
      publicoObjetivo: toStringOrNull(parsed.publico_objetivo),
      modeloNegocio: modeloValido,
      segmentoCarteraHipotesis: toStringOrNull(parsed.segmento_cartera_hipotesis),
      productosPrincipales: toStringOrNull(parsed.productos_principales),
      notas: toStringOrNull(parsed.notas),
      fuentes,
    };
  } catch {
    return null;
  }
}

/**
 * Investiga una entidad via web_search tool. Lanza ResearchError si falla.
 */
export async function researchEntityProfile(params: {
  nombCorreg: string;
  tipoEntidad: string | null;
}): Promise<ResearchResult> {
  const apiKey = await getProviderApiKey("claude");
  if (!apiKey) {
    throw new ResearchError(
      "No hay API key de Claude configurada. Configurala en /dashboard/settings -> Proveedores AI.",
      "no_api_key",
    );
  }

  const client = new Anthropic({ apiKey });

  const tipoTxt = params.tipoEntidad
    ? ` (clasificacion SBS: ${params.tipoEntidad})`
    : "";
  const userPrompt = `Investiga la siguiente entidad financiera del Peru y entrega su ficha de perfil en el formato JSON indicado.

Entidad: ${params.nombCorreg}${tipoTxt}

Buscá en las fuentes publicas que corresponda y extrae los campos solo con evidencia encontrada. Si un campo no se puede determinar con fuente, dejalo en null. Entrega solo el JSON, sin texto adicional.`;

  const t0 = Date.now();
  let response: Anthropic.Messages.Message;
  try {
    response = await client.messages.create({
      model: RESEARCH_MODEL,
      max_tokens: 2048,
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
    throw new ResearchError(`Anthropic API error: ${msg}`, "api_error");
  }
  const durationMs = Date.now() - t0;

  // Buscar el ultimo bloque de texto como output final del modelo
  const textBlocks = response.content.filter(
    (b): b is Extract<typeof b, { type: "text" }> => b.type === "text",
  );
  const lastText = textBlocks.at(-1)?.text ?? "";
  const profile = parseResearchJson(lastText);
  if (!profile) {
    throw new ResearchError(
      `LLM no devolvio JSON valido. Raw: ${lastText.slice(0, 300)}`,
      "parse_error",
    );
  }

  // Calculo de costo. Tokens + web_search queries.
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const inputCost = (inputTokens / 1_000_000) * RESEARCH_PRICING.input;
  const outputCost = (outputTokens / 1_000_000) * RESEARCH_PRICING.output;
  // Server tool use blocks tienen type "server_tool_use" — contamos cuantos
  type ServerToolBlock = { type: "server_tool_use"; name?: string };
  const toolBlocks = (response.content as unknown as Array<ServerToolBlock>).filter(
    (b) => b && b.type === "server_tool_use",
  );
  const webSearchQueries = toolBlocks.filter((b) => b.name === "web_search").length;
  const webSearchCost = webSearchQueries * RESEARCH_PRICING.webSearchPerQuery;
  const totalCost = inputCost + outputCost + webSearchCost;

  return {
    profile,
    metadata: {
      model: `${RESEARCH_MODEL} + web_search_20250305`,
      costUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
      inputTokens,
      outputTokens,
      durationMs,
    },
  };
}
