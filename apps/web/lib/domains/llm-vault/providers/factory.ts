/**
 * Factory que resuelve el InsightsProvider adecuado para un cliente.
 *
 * Prioridad de resolucion:
 *   1. Provider active + default con cliente_slug = <clienteSlug>
 *   2. Provider active + default global (cliente_slug = NULL)
 *   3. Cualquier provider active del cliente (primero por displayName)
 *   4. Cualquier provider active global
 *   5. Error (no hay provider configurado)
 *
 * El consumer del insights nunca sabe que provider se usa — solo pide
 * uno y llama generate(). Esto habilita:
 *   - Multi-tenant (cada cliente puede tener su LLM preferido)
 *   - Multi-proveedor (Claude, OpenAI, Ollama transparente al caller)
 *   - Failover (si un provider falla, agregar otro y marcarlo default)
 */

import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import { AnthropicProvider } from "./anthropic";
import { getDecryptedApiKey } from "../queries";
import { LlmProviderError, type InsightsProvider } from "./base";
import type { ProviderType } from "../types";

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
  // 1 sola query con priorizacion via ORDER BY.
  const rows = await db.execute<ResolvedRow>(sql`
    SELECT id, provider_type, model, base_url, max_tokens_output, temperature
      FROM admin.llm_providers
     WHERE is_active = true
       AND (cliente_slug IS NULL OR cliente_slug = ${clienteSlug ?? ""}::text)
     ORDER BY
       -- Match exacto por cliente_slug primero
       (cliente_slug = ${clienteSlug ?? ""}::text) DESC NULLS LAST,
       -- Luego los default
       is_default DESC,
       -- Luego el mas reciente (para estabilidad)
       created_at DESC
     LIMIT 1
  `);
  const row = rows[0];
  if (!row) {
    throw new LlmProviderError(
      "No hay LLM provider configurado. Agregar uno en /dashboard/admin/llm-settings",
      "factory",
    );
  }

  // Descifrar api key (null-safe para Ollama sin auth)
  const apiKey = await getDecryptedApiKey(row.id);

  // Update last_used_at (best-effort, no await para no bloquear generacion)
  db.execute(sql`
    UPDATE admin.llm_providers SET last_used_at = now() WHERE id = ${row.id}::uuid
  `).catch(() => {
    // silent
  });

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
