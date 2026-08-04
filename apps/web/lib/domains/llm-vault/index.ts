/**
 * Public API del dominio llm-vault.
 *
 * Post-limpieza del panel LLM Settings (V1.x): el vault dejo de tener su
 * propio panel de administracion. Los providers se configuran desde
 * /dashboard/settings > tab Proveedores AI (sistema legacy app.ai_providers).
 * Este dominio provee la abstraccion (InsightsProvider + factory) que
 * consume el service de insights.
 *
 * Se conservan las tablas admin.llm_providers y admin.llm_provider_audit
 * (V140) por si en un futuro se necesitan overrides multi-cliente — sin
 * UI activa. Los queries CRUD (queries.ts + crypto.ts + types.ts) se
 * removieron porque nadie los usa fuera del panel eliminado.
 */

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
} from "./providers/base";
