/**
 * Interface + errores compartidos por todos los InsightsProvider.
 */

import type { InsightsProvider, GenerateResult } from "../types";

export type { InsightsProvider, GenerateResult };

export class LlmProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}

export class LlmRateLimitError extends LlmProviderError {
  constructor(provider: string, cause?: unknown) {
    super(`Rate limit del provider ${provider}`, provider, cause);
    this.name = "LlmRateLimitError";
  }
}

export class LlmAuthError extends LlmProviderError {
  constructor(provider: string, cause?: unknown) {
    super(`API key invalida o expirada en ${provider}`, provider, cause);
    this.name = "LlmAuthError";
  }
}
