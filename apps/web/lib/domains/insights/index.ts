/**
 * Public API del dominio insights.
 */

export {
  generateInsight,
  getCachedInsight,
  getCurrentPromptVersion,
  InsightsError,
} from "./service";

export { peerGroupHash } from "./hash";

export type {
  InsightSeccion,
  ReportInsight,
  GenerateInsightInput,
  GenerateInsightResult,
} from "./types";
export { INSIGHT_SECCIONES } from "./types";
