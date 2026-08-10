/**
 * Service principal — genera o retorna cache de un insight.
 *
 * Flujo:
 *   1. Calcular peer_group_hash
 *   2. Buscar en cache (admin.report_insights)
 *   3. Si hit -> retornar bullets (o override si existe)
 *   4. Si miss:
 *      a. Chequear rate limit (por cliente + por usuario)
 *      b. Resolver LLM provider via vault
 *      c. Ejecutar prompt
 *      d. Parsear output (JSON array de strings)
 *      e. Persistir en cache + registrar usage
 *      f. Retornar bullets
 */

import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import { getProviderForCliente, LlmProviderError } from "@/lib/domains/llm-vault";
import { peerGroupHash } from "./hash";
import { promptMargenNeto } from "./prompts/margen-neto";
import { promptCarteraBruta } from "./prompts/cartera-bruta";
import { promptMoraGlobal } from "./prompts/mora-global";
import { promptSolvencia } from "./prompts/solvencia";
import { promptLiquidez } from "./prompts/liquidez";
import { promptCobertura } from "./prompts/cobertura";
import { promptPuntoEquilibrio } from "./prompts/punto-equilibrio";
import type { PromptTemplate } from "./prompts/base";
import type {
  GenerateInsightInput,
  GenerateInsightResult,
  InsightSeccion,
  PromptContext,
  ReportInsight,
} from "./types";

const PROMPT_REGISTRY: Partial<Record<InsightSeccion, PromptTemplate>> = {
  margen_neto: promptMargenNeto,
  cartera_bruta: promptCarteraBruta,
  mora_global: promptMoraGlobal,
  solvencia: promptSolvencia,
  liquidez: promptLiquidez,
  cobertura: promptCobertura,
  punto_equilibrio: promptPuntoEquilibrio,
};

/**
 * Version actual del prompt para una seccion. Se usa como cache-key
 * implicito: si la version cambia, un cache "hit" con version distinta
 * se trata como MISS y se regenera (invalidacion transparente).
 */
export function getCurrentPromptVersion(seccion: InsightSeccion): string | null {
  return PROMPT_REGISTRY[seccion]?.version ?? null;
}

export class InsightsError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "rate_limit"
      | "no_provider"
      | "llm_error"
      | "parse_error"
      | "unsupported_seccion",
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "InsightsError";
  }
}

/**
 * Devuelve el insight cacheado si existe. NO genera si falta —
 * usar para el fetch inicial del componente (evita costos accidentales).
 */
export async function getCachedInsight(
  input: Pick<GenerateInsightInput, "periodo" | "seccion" | "entidadPropia" | "peerGroup">,
): Promise<ReportInsight | null> {
  const hash = peerGroupHash(input.peerGroup, input.entidadPropia);
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT id, periodo, seccion, peer_group_hash, cliente_slug,
           bullets, override_bullets, override_reason,
           model, prompt_version,
           tokens_input, tokens_output, cost_usd,
           generated_at, generated_by, duration_ms,
           reviewed_at, reviewed_by
      FROM admin.report_insights
     WHERE periodo = ${input.periodo}::int
       AND seccion = ${input.seccion}::text
       AND peer_group_hash = ${hash}::text
     LIMIT 1
  `);
  const r = rows[0];
  return r ? rowToInsight(r) : null;
}

/**
 * Genera un insight (o devuelve cache si existe). Chequea rate limits
 * antes de llamar al LLM.
 */
export async function generateInsight(
  input: GenerateInsightInput,
  actor: { email: string },
): Promise<GenerateInsightResult> {
  // Verificar seccion soportada
  const template = PROMPT_REGISTRY[input.seccion];
  if (!template) {
    throw new InsightsError(
      `Seccion '${input.seccion}' no tiene prompt template implementado`,
      "unsupported_seccion",
    );
  }

  // Cache check — solo hit si la version del cache coincide con la
  // version actual del template. Si un override manual existe, respetarlo
  // incluso si la version base cambio.
  const cached = await getCachedInsight(input);
  const versionMatch = cached?.promptVersion === template.version;
  if (cached && (versionMatch || cached.overrideBullets)) {
    return {
      bullets: cached.overrideBullets ?? cached.bullets,
      model: cached.model,
      tokensInput: cached.tokensInput,
      tokensOutput: cached.tokensOutput,
      costUsd: cached.costUsd,
      durationMs: cached.durationMs ?? 0,
      fromCache: true,
    };
  }

  // Rate limit check
  const rateCheck = await db.execute<{ result: Record<string, unknown> }>(sql`
    SELECT admin.check_insights_rate_limit(${input.clienteSlug}::text, ${actor.email}::text) AS result
  `);
  const rl = rateCheck[0]?.result;
  if (rl && rl.allowed === false) {
    throw new InsightsError(
      `Rate limit alcanzado: ${rl.reason}`,
      "rate_limit",
      rl as Record<string, unknown>,
    );
  }

  // Resolver provider
  let provider;
  try {
    provider = await getProviderForCliente(input.clienteSlug);
  } catch (err) {
    if (err instanceof LlmProviderError) {
      throw new InsightsError(err.message, "no_provider");
    }
    throw err;
  }

  // Armar prompt context
  const periodoAnterior = calcularPeriodoAnterior(input.periodo);
  const promptCtx: PromptContext = {
    ...input,
    periodoLabel: periodoLabel(input.periodo),
    periodoAnterior,
    periodoAnteriorLabel: periodoLabel(periodoAnterior),
  };
  const { system, user } = template.build(promptCtx);

  // Llamar al LLM. maxTokens=4000 permite output de 5-7 bullets de 2-4
  // lineas cada uno con analisis causal + cierre prescriptivo (Implica/
  // Accion/Riesgo). Bajo esto los prompts v4 se truncan a mitad del array.
  const t0 = Date.now();
  let result;
  try {
    result = await provider.generate(user, { system, maxTokens: 4000 });
  } catch (err) {
    throw new InsightsError(
      err instanceof Error ? err.message : String(err),
      "llm_error",
    );
  }
  const durationMs = Date.now() - t0;

  // Parsear output: debe ser JSON array de strings
  const bullets = parseBulletsJson(result.text);
  if (bullets.length === 0) {
    throw new InsightsError(
      `LLM devolvio output no parseable como JSON array. Raw: ${result.text.slice(0, 200)}`,
      "parse_error",
    );
  }

  // Persistir en cache + usage
  const hash = peerGroupHash(input.peerGroup, input.entidadPropia);
  // Drizzle serializa arrays JS como tupla/record cuando se pasan como
  // parametro con cast ::text[]. Fix: construir array literal explicito
  // con ARRAY[...]::text[] usando sql.join sobre cada bullet.
  const bulletsSql =
    bullets.length === 0
      ? sql`ARRAY[]::text[]`
      : sql`ARRAY[${sql.join(bullets.map((b) => sql`${b}`), sql`, `)}]::text[]`;

  await db.execute(sql`
    INSERT INTO admin.report_insights (
      periodo, seccion, peer_group_hash, cliente_slug,
      bullets, model, prompt_version,
      contexto_json,
      tokens_input, tokens_output, cost_usd,
      generated_by, duration_ms
    ) VALUES (
      ${input.periodo}::int,
      ${input.seccion}::text,
      ${hash}::text,
      ${input.clienteSlug}::text,
      ${bulletsSql},
      ${result.model}::text,
      ${template.version}::text,
      ${JSON.stringify(input.contexto)}::jsonb,
      ${result.usage.inputTokens}::int,
      ${result.usage.outputTokens}::int,
      ${result.usage.costUsd}::numeric,
      ${`user:${actor.email}`}::text,
      ${durationMs}::int
    )
    ON CONFLICT (periodo, seccion, peer_group_hash)
    DO UPDATE SET
      bullets        = EXCLUDED.bullets,
      model          = EXCLUDED.model,
      prompt_version = EXCLUDED.prompt_version,
      contexto_json  = EXCLUDED.contexto_json,
      tokens_input   = EXCLUDED.tokens_input,
      tokens_output  = EXCLUDED.tokens_output,
      cost_usd       = EXCLUDED.cost_usd,
      generated_at   = now(),
      generated_by   = EXCLUDED.generated_by,
      duration_ms    = EXCLUDED.duration_ms
  `);

  // Registrar usage del usuario para rate limit
  await db
    .execute(sql`
      INSERT INTO admin.insights_user_usage
        (user_email, cliente_slug, periodo, seccion, cost_usd)
      VALUES (
        ${actor.email}::text,
        ${input.clienteSlug}::text,
        ${input.periodo}::int,
        ${input.seccion}::text,
        ${result.usage.costUsd}::numeric
      )
    `)
    .catch(() => {
      // best-effort — no romper la generacion si falla el usage log
    });

  return {
    bullets,
    model: result.model,
    tokensInput: result.usage.inputTokens,
    tokensOutput: result.usage.outputTokens,
    costUsd: result.usage.costUsd,
    durationMs,
    fromCache: false,
  };
}

/**
 * Parsea el output del LLM como JSON array de strings.
 * Tolera desviaciones: markdown fences, whitespace, trailing commas y
 * truncados (si el LLM se corto a mitad de bullet, salvamos los completos).
 */
function parseBulletsJson(text: string): string[] {
  const cleaned = text
    .trim()
    // Quitar ```json ... ``` si el LLM se equivoco
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Intento directo
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
  } catch {
    // fallthrough
  }

  // Recuperacion de truncados: intenta cerrar el array recortando hasta
  // el ultimo string bien cerrado. Ejemplo: `["a", "b", "c incom`
  //   -> retry como `["a", "b"]`
  const startIdx = cleaned.indexOf("[");
  if (startIdx < 0) return [];
  const body = cleaned.slice(startIdx);
  // Encuentra la ultima comilla-doble que abre O cierra un string bien
  // formado, y recorta ahi para intentar reparar.
  for (let end = body.length - 1; end > 0; end--) {
    if (body[end] !== "\"") continue;
    const candidate = body.slice(0, end + 1).replace(/,\s*$/, "") + "]";
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
    } catch {
      // sigue buscando
    }
  }

  return [];
}

function calcularPeriodoAnterior(periodo: number): number {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return (anio - 1) * 100 + mes;
}

function periodoLabel(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${meses[mes - 1] ?? "?"} ${anio}`;
}

function rowToInsight(r: Record<string, unknown>): ReportInsight {
  return {
    id: String(r.id),
    periodo: Number(r.periodo),
    seccion: String(r.seccion) as InsightSeccion,
    peerGroupHash: String(r.peer_group_hash),
    clienteSlug: r.cliente_slug == null ? null : String(r.cliente_slug),
    bullets: (r.bullets ?? []) as string[],
    overrideBullets: (r.override_bullets ?? null) as string[] | null,
    overrideReason: r.override_reason == null ? null : String(r.override_reason),
    model: String(r.model),
    promptVersion: String(r.prompt_version),
    tokensInput: Number(r.tokens_input ?? 0),
    tokensOutput: Number(r.tokens_output ?? 0),
    costUsd: Number(r.cost_usd ?? 0),
    generatedAt: String(r.generated_at),
    generatedBy: String(r.generated_by),
    durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
    reviewedAt: r.reviewed_at == null ? null : String(r.reviewed_at),
    reviewedBy: r.reviewed_by == null ? null : String(r.reviewed_by),
  };
}
