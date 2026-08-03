/**
 * Factory que resuelve el InsightsProvider adecuado para un cliente.
 *
 * Prioridad de resolucion (sistema unificado):
 *   1. app.ai_providers (sistema LEGACY compartido con /dashboard/settings
 *      -> tab "Proveedores AI" y modulo Aiben NL2SQL). Es donde el
 *      usuario final configura las keys. Se busca en orden: claude ->
 *      gemini -> openai -> ollama y se usa el primero enabled + con key.
 *   2. admin.llm_providers (V140, sistema nuevo con scope multi-tenant).
 *      Solo se consulta si el legacy no tiene ninguno habilitado.
 *
 * Este orden garantiza que el usuario que configuro Claude desde
 * /dashboard/settings vea insights funcionando sin doble configuracion.
 */

import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import { AnthropicProvider } from "./anthropic";
import { getDecryptedApiKey } from "../queries";
import { getProviderApiKey, type AiProviderId } from "@/lib/domains/ai-providers";
import { LlmProviderError, type InsightsProvider } from "./base";
import type { ProviderType } from "../types";

/**
 * Prioridad para elegir un provider del sistema legacy app.ai_providers.
 * Alineado con el orden visual en /dashboard/settings.
 */
const LEGACY_PRIORITY: AiProviderId[] = ["claude", "gemini", "openai", "ollama"];

const LEGACY_TO_TYPE: Record<AiProviderId, { type: ProviderType; defaultModel: string }> = {
  claude: { type: "anthropic", defaultModel: "claude-haiku-4-5" },
  openai: { type: "openai", defaultModel: "gpt-4o-mini" },
  ollama: { type: "ollama", defaultModel: "qwen2.5:7b" },
  gemini: { type: "google", defaultModel: "gemini-2.0-flash" },
};

type ResolvedRow = {
  id: string;
  provider_type: ProviderType;
  model: string;
  base_url: string | null;
  max_tokens_output: number;
  temperature: string | number;
};

/**
 * Resuelve el provider a usar para un cliente. Devuelve una instancia
 * lista para llamar .generate(). Tira LlmProviderError si no hay ninguno.
 */
export async function getProviderForCliente(
  clienteSlug: string | null,
): Promise<InsightsProvider> {
  // Intento 1: sistema legacy app.ai_providers (donde el usuario carga
  // las keys desde /dashboard/settings). Es lo que ya conoce y usa.
  const legacy = await tryResolveLegacy();
  if (legacy) return legacy;

  // Intento 2: sistema nuevo admin.llm_providers (V140). Multi-tenant
  // con overrides por cliente_slug. Path para configuraciones avanzadas
  // via /dashboard/admin/llm-settings.
  const rows = await db.execute<ResolvedRow>(sql`
    SELECT id, provider_type, model, base_url, max_tokens_output, temperature
      FROM admin.llm_providers
     WHERE is_active = true
       AND (cliente_slug IS NULL OR cliente_slug = ${clienteSlug ?? ""}::text)
     ORDER BY
       (cliente_slug = ${clienteSlug ?? ""}::text) DESC NULLS LAST,
       is_default DESC,
       created_at DESC
     LIMIT 1
  `);
  const row = rows[0];
  if (!row) {
    throw new LlmProviderError(
      "No hay LLM provider configurado. Habilita Claude/OpenAI/Ollama/Gemini " +
        "en /dashboard/settings -> pestaña 'Proveedores AI'.",
      "factory",
    );
  }

  const apiKey = await getDecryptedApiKey(row.id);
  db.execute(sql`
    UPDATE admin.llm_providers SET last_used_at = now() WHERE id = ${row.id}::uuid
  `).catch(() => {});

  return instantiate({
    id: row.id,
    providerType: row.provider_type,
    model: row.model,
    apiKey,
    baseUrl: row.base_url,
    maxTokens: Number(row.max_tokens_output),
    temperature: Number(row.temperature),
  });
}

/**
 * Intenta resolver un provider desde app.ai_providers (sistema legacy).
 * Devuelve null si ninguno esta enabled + tiene api key configurada.
 */
async function tryResolveLegacy(): Promise<InsightsProvider | null> {
  const rows = await db.execute<{
    provider: AiProviderId;
    model_default: string | null;
    base_url: string | null;
  }>(sql`
    SELECT provider, model_default, base_url
      FROM app.ai_providers
     WHERE enabled = true
       AND api_key_encrypted IS NOT NULL
  `);
  if (rows.length === 0) return null;

  const disponibles = new Map(rows.map((r) => [r.provider, r]));
  for (const providerId of LEGACY_PRIORITY) {
    const cfg = disponibles.get(providerId);
    if (!cfg) continue;
    const mapping = LEGACY_TO_TYPE[providerId];
    if (!mapping) continue;
    // MVP: solo anthropic implementado. Los demas caen al sistema V140.
    if (mapping.type !== "anthropic") continue;

    const apiKey = await getProviderApiKey(providerId);
    if (!apiKey) continue;

    return instantiate({
      id: `legacy:${providerId}`,
      providerType: mapping.type,
      model: cfg.model_default ?? mapping.defaultModel,
      apiKey,
      baseUrl: cfg.base_url,
      maxTokens: 800,
      temperature: 0.3,
    });
  }
  return null;
}

/**
 * Instancia un provider a partir de sus datos y api key ya descifrada.
 * Extraida para reuso desde el endpoint de test (que necesita instanciar
 * un provider "ad-hoc" con la key que el user pego en el formulario).
 */
export function instantiate(cfg: {
  id: string;
  providerType: ProviderType;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
  maxTokens: number;
  temperature: number;
}): InsightsProvider {
  switch (cfg.providerType) {
    case "anthropic":
      if (!cfg.apiKey) {
        throw new LlmProviderError("Anthropic requiere API key", "anthropic");
      }
      return new AnthropicProvider({
        apiKey: cfg.apiKey,
        model: cfg.model,
        maxTokens: cfg.maxTokens,
        temperature: cfg.temperature,
      });

    // Placeholders para futuros providers. La estructura ya esta lista —
    // solo agregar el archivo openai.ts / ollama.ts y descomentar aca.
    case "openai":
    case "openai_compatible":
    case "ollama":
    case "google":
      throw new LlmProviderError(
        `Provider '${cfg.providerType}' aun no implementado (MVP tiene solo anthropic). ` +
          "Agregar impl en lib/domains/llm-vault/providers/",
        cfg.providerType,
      );

    default: {
      const _exhaustive: never = cfg.providerType;
      throw new LlmProviderError(`Provider desconocido: ${_exhaustive}`, "factory");
    }
  }
}
