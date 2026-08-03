/**
 * Types del dominio llm-vault.
 *
 * Introducido por V140 — vault de credenciales de proveedores LLM
 * (Claude, OpenAI, Ollama, etc.) con encriptacion at-rest.
 */

export type ProviderType =
  | "anthropic"
  | "openai"
  | "ollama"
  | "openai_compatible"
  | "google";

/**
 * Provider vista sanitizada — la que consume la UI admin y todos los
 * endpoints. NUNCA incluye la api_key en plain text ni el bytea cifrado.
 */
export type LlmProviderPublic = {
  id: string;
  providerType: ProviderType;
  displayName: string;
  model: string;
  apiKeyHint: string | null;
  hasApiKey: boolean;
  baseUrl: string | null;
  clienteSlug: string | null;
  isActive: boolean;
  isDefault: boolean;
  maxTokensOutput: number;
  temperature: number;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  rotatedAt: string | null;
  lastUsedAt: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
};

/**
 * Input para crear/actualizar un provider. La apiKey se cifra al guardar
 * y jamas se retorna al caller.
 */
export type LlmProviderInput = {
  providerType: ProviderType;
  displayName: string;
  model: string;
  /** Plain text — se cifra al guardar. Omitir para Ollama sin auth. */
  apiKey?: string | null;
  baseUrl?: string | null;
  clienteSlug?: string | null;
  isActive?: boolean;
  isDefault?: boolean;
  maxTokensOutput?: number;
  temperature?: number;
};

/**
 * Resultado de una generacion LLM. Se persiste en report_insights
 * para cost tracking y cache.
 */
export type GenerateResult = {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    /** Costo total en USD, calculado por el provider en base a su pricing. */
    costUsd: number;
  };
  model: string;
  finishReason: string;
};

export type GenerateOptions = {
  /** Sistema prompt (opcional). Se antepone al user prompt. */
  system?: string;
  /** Max tokens del output. Override del provider default. */
  maxTokens?: number;
  /** 0=deterministico, 1=creativo. Override del provider default. */
  temperature?: number;
};

/**
 * Interface que TODOS los providers implementan. Consumers piden un
 * provider al factory y llaman generate() sin saber cual es.
 */
export interface InsightsProvider {
  /** Identificador del provider (ej. "anthropic/claude-haiku-4-5"). */
  readonly name: string;
  /** Genera texto en respuesta al prompt. */
  generate(prompt: string, opts?: GenerateOptions): Promise<GenerateResult>;
  /** Ping ligero para test de conexion desde la UI. */
  testConnection(): Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * Audit entry — lo que se persiste en admin.llm_provider_audit al hacer
 * cualquier cambio a un provider.
 */
export type LlmAuditAction =
  | "created"
  | "updated"
  | "key_rotated"
  | "set_default"
  | "unset_default"
  | "activated"
  | "deactivated"
  | "deleted"
  | "test_success"
  | "test_failed";
