/**
 * Servicio Genie: genera SQL desde lenguaje natural usando Claude API.
 *
 * Fluido:
 *  1. recibe prompt del usuario
 *  2. arma system prompt con catalog snapshot (cacheado)
 *  3. llama a Claude (Anthropic API) con prompt caching habilitado (system
 *     marcado como ephemeral cacheable -> 90% costo savings cuando el catalog
 *     no cambia entre requests)
 *  4. parsea JSON respuesta
 *  5. valida el SQL con el sandbox validator antes de devolverlo
 *  6. guarda en app.genie_history
 */

import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { ValidationError } from "@/lib/domains/shared";
import { validateSql } from "@/lib/domains/sql-workbench";

import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import type { GenieRequest, GenieResponse } from "./types";

const MODELO_DEFAULT = "claude-opus-4-7";
const MAX_TOKENS = 2048;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY no esta definida. Configurala en .env / EasyPanel para habilitar Genie.",
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
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
  const systemPrompt = await buildSystemPrompt();
  const userPrompt = buildUserPrompt(req);

  const c = client();
  const response = await c.messages.create({
    model: MODELO_DEFAULT,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: systemPrompt,
        // Prompt caching: el catalog snapshot cambia raramente. Marcarlo como
        // cacheable reduce costo significativamente en uso continuo.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const duracionMs = Date.now() - start;
  const tokensInput = response.usage.input_tokens ?? 0;
  const tokensOutput = response.usage.output_tokens ?? 0;

  // Parsear JSON de la respuesta
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Respuesta sin contenido de texto");
  }
  const raw = textBlock.text.trim();
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
      modelo: MODELO_DEFAULT,
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
    modelo: MODELO_DEFAULT,
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
    modelo: MODELO_DEFAULT,
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
