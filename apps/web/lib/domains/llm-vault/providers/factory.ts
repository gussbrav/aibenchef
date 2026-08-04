/**
 * Factory que resuelve el InsightsProvider adecuado para un cliente.
 *
 * Fuente unica de credenciales: app.ai_providers (sistema legacy
 * compartido con /dashboard/settings > tab "Proveedores AI" y modulo
 * Aiben NL2SQL). Se busca en el orden: claude -> gemini -> openai ->
 * ollama y se usa el primero enabled + con api key.
 *
 * Se removio el fallback a admin.llm_providers (V140) porque el panel
 * LLM Settings fue eliminado — nadie carga credenciales ahi. Las tablas
 * V140 siguen creadas por si en un futuro se retoma el diseño multi-tenant
 * con overrides por cliente.
 */

import "server-only";

import { AnthropicProvider } from "./anthropic";
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

/**
 * Resuelve el provider a usar para un cliente. Devuelve una instancia
 * lista para llamar .generate(). Tira LlmProviderError si no hay ninguno.
 * clienteSlug se acepta como parametro para preservar la firma que ya
 * consume el service de insights — en la implementacion actual no se
 * usa (no hay overrides por cliente sin el panel).
 */
export async function getProviderForCliente(
  _clienteSlug: string | null,
): Promise<InsightsProvider> {
  const { sql } = await import("drizzle-orm");
  const { db } = await import("@/lib/infrastructure/db");
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
  if (rows.length === 0) {
    throw new LlmProviderError(
      "No hay LLM provider configurado. Habilita Claude/OpenAI/Ollama/Gemini " +
        "en /dashboard/settings -> pestaña 'Proveedores AI'.",
      "factory",
    );
  }

  const disponibles = new Map(rows.map((r) => [r.provider, r]));
  for (const providerId of LEGACY_PRIORITY) {
    const cfg = disponibles.get(providerId);
    if (!cfg) continue;
    const mapping = LEGACY_TO_TYPE[providerId];
    if (!mapping) continue;
    // MVP: solo anthropic implementado. Los demas quedan skipped hasta
    // que sumemos openai.ts / gemini.ts / ollama.ts en providers/.
    if (mapping.type !== "anthropic") continue;

    const apiKey = await getProviderApiKey(providerId);
    if (!apiKey) continue;

    return instantiate({
      providerType: mapping.type,
      model: cfg.model_default ?? mapping.defaultModel,
      apiKey,
      baseUrl: cfg.base_url,
      maxTokens: 800,
      temperature: 0.3,
    });
  }

  throw new LlmProviderError(
    "No hay provider soportado configurado. En este momento solo Claude " +
      "(Anthropic) tiene implementacion — habilita Claude en Proveedores AI.",
    "factory",
  );
}

/**
 * Instancia un provider a partir de sus datos y api key ya descifrada.
 * Exportada por si el endpoint de test necesita instanciar ad-hoc con la
 * key del formulario antes de guardarla.
 */
export function instantiate(cfg: {
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
