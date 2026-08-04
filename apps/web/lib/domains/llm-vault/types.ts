/**
 * Types del dominio llm-vault.
 *
 * Post-limpieza del panel LLM Settings: quedan solo los tipos que consume
 * el factory + los providers concretos. Los tipos CRUD (LlmProviderPublic,
 * LlmProviderInput, LlmAuditAction) se removieron junto con queries.ts.
 */

export type ProviderType =
  | "anthropic"
  | "openai"
  | "ollama"
  | "openai_compatible"
  | "google";

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
