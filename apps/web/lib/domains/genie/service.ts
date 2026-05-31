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
//
// Reglas:
//  * Un provider DESHABILITADO en DB pero con ENV var seteada SIGUE siendo
//    valido — el env es el override de operador/deploy (util cuando ni se
//    quiere persistir la key en DB). Reportamos como "envOverride".
//  * Ollama acepta ENV OLLAMA_BASE_URL como fallback a la config DB.
//  * El diagnostico se acumula en `estados` para que el mensaje al usuario
//    explique exactamente porque ningun provider sirvio.
async function resolveProvider(): Promise<{
  provider: AiProviderId;
  llm: LLMProvider;
  modelo: string;
}> {
  const estados: string[] = [];

  for (const id of PROVIDER_PRIORITY) {
    try {
      const cfg = await getProvider(id).catch(() => null);
      const envOnly = !cfg || !cfg.enabled;

      if (id === "claude") {
        const apiKey =
          (cfg?.enabled
            ? await getProviderApiKey("claude").catch(() => null)
            : null) ||
          process.env.ANTHROPIC_API_KEY ||
          null;
        if (!apiKey) {
          estados.push(envOnly ? "claude (deshabilitado y sin env)" : "claude (sin api key)");
          continue;
        }
        const modelo = cfg?.modelDefault || "claude-opus-4-7";
        return { provider: "claude", llm: new ClaudeProvider(apiKey, modelo), modelo };
      }

      if (id === "ollama") {
        const baseUrl =
          (cfg?.enabled ? cfg.baseUrl : null) ||
          process.env.OLLAMA_BASE_URL ||
          null;
        if (!baseUrl) {
          estados.push(envOnly ? "ollama (deshabilitado y sin OLLAMA_BASE_URL env)" : "ollama (sin baseUrl)");
          continue;
        }
        if (envOnly && !process.env.OLLAMA_BASE_URL) {
          estados.push("ollama (deshabilitado)");
          continue;
        }
        const apiKey =
          (cfg?.enabled
            ? await getProviderApiKey("ollama").catch(() => null)
            : null) ?? undefined;
        const modelo = cfg?.modelDefault || process.env.OLLAMA_MODEL || "llama3.1:8b";
        return {
          provider: "ollama",
          llm: new OllamaProvider(baseUrl, modelo, apiKey ?? undefined),
          modelo,
        };
      }

      // openai / gemini: stub — agregar adapter cuando se necesite
      estados.push(`${id} (adapter pendiente)`);
    } catch (e) {
      estados.push(`${id} (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  throw new GenieNotConfiguredError(estados.join("; "));
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
    // ValidationError -> response HTTP 400 con mensaje friendly visible.
    // Antes lanzabamos new Error() y handleRoute lo capturaba como
    // "Error interno del servidor" en prod sin pistas — el usuario veia el
    // 500 generico sin saber que era un problema de red al provider.
    throw new ValidationError(
      `El proveedor LLM "${provider}" no respondio: ${msg}`,
      { provider, hint:
        provider === "ollama"
          ? "Verifica que la baseUrl de Ollama sea alcanzable desde el contenedor web (los nombres tipo 'azoramind_ollama' solo resuelven dentro de la misma red Docker)."
          : "Revisa la api key y la conectividad al proveedor.",
      },
    );
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
    throw new ValidationError(
      `El proveedor LLM (${provider}) no devolvio JSON valido. Inicio respuesta: ${raw.slice(0, 200)}`,
      { provider, modelo },
    );
  }

  if (!parsed.sql || typeof parsed.sql !== "string") {
    throw new ValidationError(
      `El proveedor LLM (${provider}) respondio sin campo "sql"`,
      { provider, modelo },
    );
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
