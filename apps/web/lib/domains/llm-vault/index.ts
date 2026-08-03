/**
 * Public API del dominio llm-vault.
 *
 * Los consumers importan siempre desde aqui, no de submodulos directos.
 * Encapsulacion garantiza que:
 *   - crypto.ts solo se importe server-side (via server-only)
 *   - queries.ts nunca exponga api_key_encrypted al caller
 *   - factory.ts sea la unica forma de obtener un InsightsProvider
 */

export {
  listProviders,
  getProviderById,
  createProvider,
  updateProvider,
  deleteProvider,
  setDefaultProvider,
  recordTestResult,
} from "./queries";

export { getProviderForCliente, instantiate } from "./providers/factory";

export {
  LlmProviderError,
  LlmRateLimitError,
  LlmAuthError,
} from "./providers/base";

export type {
  InsightsProvider,
  GenerateResult,
  GenerateOptions,
  LlmProviderPublic,
  LlmProviderInput,
  ProviderType,
  LlmAuditAction,
} from "./types";
