/**
 * Servicio Genie: genera SQL desde lenguaje natural usando un LLM provider.
 *
 * Multi-proveedor: detecta cual proveedor esta habilitado en app.ai_providers
 * y usa ese. Orden de prioridad: Claude > Ollama > OpenAI > Gemini.
 *
 * Flujo:
 *  1. recibe prompt del usuario
 *  2. arma system prompt con catalog snapshot (cacheado 5min)
 *  3. selecciona provider activo (Claude/Ollama/etc)
 *  4. llama provider.generateJson(systemPrompt, userPrompt)
 *  5. parsea JSON respuesta
 *  6. valida el SQL con el sandbox validator antes de devolverlo
 *  7. guarda en app.genie_history
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { ValidationError } from "@/lib/domains/shared";
import {
  type AiProviderId,
  getProvider,
  getProviderApiKey,
} from "@/lib/domains/ai-providers";
import { validateSql } from "@/lib/domains/sql-workbench";

import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { ClaudeProvider } from "./providers/claude";
import { OllamaProvider } from "./providers/ollama";
import type { LLMProvider } from "./providers/types";
import type { GenieRequest, GenieResponse } from "./types";

const MAX_TOKENS = 2048;

// Orden de preferencia cuando hay multiples providers habilitados
const PROVIDER_PRIORITY: AiProviderId[] = ["claude", "ollama", "openai", "gemini"];

class GenieNotConfiguredError extends ValidationError {
  constructor(detalle?: string) {
    super(
      "Genie no esta configurado: ningun proveedor LLM tiene API key seteada. " +
        "Configura uno en /dashboard/settings (Claude, Ollama, OpenAI o Gemini)." +
        (detalle ? ` Detalle: ${detalle}` : ""),
      { paso: "config" },
    );
  }
}

// Resuelve el primer provider habilitado con config valida.
async function resolveProvider(): Promise<{
  provider: AiProviderId;
  llm: LLMProvider;
  modelo: string;
}> {
  const errores: string[] = [];

  for (const id of PROVIDER_PRIORITY) {
    try {
      const cfg = await getProvider(id);
      if (!cfg.enabled) continue;

      if (id === "claude") {
        const apiKey =
          (await getProviderApiKey("claude").catch(() => null)) ||
          process.env.ANTHROPIC_API_KEY ||
          null;
        if (!apiKey) {
          errores.push("claude (sin api key)");
          continue;
        }
        const modelo = cfg.modelDefault || "claude-opus-4-7";
        return { provider: "claude", llm: new ClaudeProvider(apiKey, modelo), modelo };
      }

      if (id === "ollama") {
        if (!cfg.baseUrl) {
          errores.push("ollama (sin baseUrl)");
          continue;
        }
        const apiKey = (await getProviderApiKey("ollama").catch(() => null)) ?? undefined;
        const modelo = cfg.modelDefault || "llama3.1:8b";
        return {
          provider: "ollama",
          llm: new OllamaProvider(cfg.baseUrl, modelo, apiKey ?? undefined),
          modelo,
        };
      }

      // openai / gemini: stub — agregar adapter cuando se necesite
      errores.push(`${id} (adapter pendiente)`);
    } catch (e) {
      errores.push(`${id} (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  throw new GenieNotConfiguredError(errores.join("; "));
}

export async function generarSqlDesdeNl(
  userId: string,
  req: GenieRequest,
): Promise<GenieResponse> {
  if (!req.prompt || !req.prompt.trim()) {
    throw new ValidationError("Prompt vacio", {});
  }
  if (req.prompt.length > 5000) {
    throw new ValidationError("Prompt muy largo (max 5000 chars)", {});
  }

  const start = Date.now();
  const { provider, llm, modelo } = await resolveProvider();
  const systemPrompt = await buildSystemPrompt();
  const userPrompt = buildUserPrompt(req);

  let generationResult;
  try {
    generationResult = await llm.generateJson({
      systemPrompt,
      userPrompt,
      maxTokens: MAX_TOKENS,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Provider ${provider} fallo: ${msg}`);
  }

  const duracionMs = Date.now() - start;
  const tokensInput = generationResult.tokensInput;
  const tokensOutput = generationResult.tokensOutput;
  const raw = generationResult.text.trim();
  // Aceptar markdown fences como fallback aunque pedimos sin
  const jsonStr = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: { sql?: string; explicacion?: string };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Claude no devolvio JSON valido. Respuesta: ${raw.slice(0, 200)}`);
  }

  if (!parsed.sql || typeof parsed.sql !== "string") {
    throw new Error("Respuesta sin campo 'sql'");
  }

  const sqlGenerado = parsed.sql.trim();
  const explicacion = (parsed.explicacion ?? "").trim();

  // Validar con el mismo sandbox: si Claude alucina algo prohibido, fallamos rapido
  try {
    validateSql(sqlGenerado);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Guardar el intento fallido en history para analizar despues
    await persistHistory(userId, {
      prompt: req.prompt,
      sql: sqlGenerado,
      explicacion,
      modelo: modelo,
      tokensInput,
      tokensOutput,
      duracionMs,
      ejecutado: false,
      exitoso: false,
      error: `SQL invalido segun sandbox: ${msg}`,
    });
    throw new ValidationError(
      `El SQL generado por Genie no paso las reglas de seguridad: ${msg}`,
      { sqlGenerado: sqlGenerado.slice(0, 200) },
    );
  }

  const id = await persistHistory(userId, {
    prompt: req.prompt,
    sql: sqlGenerado,
    explicacion,
    modelo: modelo,
    tokensInput,
    tokensOutput,
    duracionMs,
    ejecutado: false,
    exitoso: null,
  });

  return {
    id,
    sql: sqlGenerado,
    explicacion,
    modelo: modelo,
    tokensInput,
    tokensOutput,
    duracionMs,
  };
}

async function persistHistory(
  userId: string,
  data: {
    prompt: string;
    sql: string;
    explicacion: string;
    modelo: string;
    tokensInput: number;
    tokensOutput: number;
    duracionMs: number;
    ejecutado: boolean;
    exitoso: boolean | null;
    error?: string;
  },
): Promise<number> {
  try {
    const rows = await db.execute<{ id: number }>(
      sql`
        INSERT INTO app.genie_history
          (user_id, prompt, sql_generado, explicacion, modelo,
           tokens_input, tokens_output, duracion_ms, ejecutado, exitoso, error)
        VALUES
          (${userId}, ${data.prompt}, ${data.sql}, ${data.explicacion}, ${data.modelo},
           ${data.tokensInput}, ${data.tokensOutput}, ${data.duracionMs},
           ${data.ejecutado}, ${data.exitoso}, ${data.error ?? null})
        RETURNING id
      `,
    );
    return Number(rows[0]?.id ?? 0);
  } catch {
    return 0;
  }
}

export async function marcarFeedback(
  userId: string,
  id: number,
  feedback: 1 | -1,
): Promise<void> {
  await db.execute(
    sql`
      UPDATE app.genie_history
      SET feedback = ${feedback}
      WHERE id = ${id} AND user_id = ${userId}
    `,
  );
}
