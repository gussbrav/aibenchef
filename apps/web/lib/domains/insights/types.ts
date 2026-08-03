/**
 * Types del dominio insights.
 *
 * Introducido por V141 — insights AI-generados por seccion del informe
 * (Margen Neto, Cartera Bruta, Mora Global, etc.) con cache DB permanente
 * y cost tracking.
 */

export type InsightSeccion =
  | "margen_neto"
  | "cartera_bruta"
  | "mora_global"
  | "cobertura_car"
  | "rendimiento_cartera"
  | "costo_fondeo"
  | "eficiencia"
  | "utilidad_neta"
  | "roe"
  | "roa";

export const INSIGHT_SECCIONES: InsightSeccion[] = [
  "margen_neto",
  "cartera_bruta",
  "mora_global",
  "cobertura_car",
  "rendimiento_cartera",
  "costo_fondeo",
  "eficiencia",
  "utilidad_neta",
  "roe",
  "roa",
];

export type ReportInsight = {
  id: string;
  periodo: number;
  seccion: InsightSeccion;
  peerGroupHash: string;
  clienteSlug: string | null;
  /** Bullets a mostrar en la UI. Si hay overrideBullets, usar ese. */
  bullets: string[];
  overrideBullets: string[] | null;
  overrideReason: string | null;
  model: string;
  promptVersion: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  generatedAt: string;
  generatedBy: string;
  durationMs: number | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

/**
 * Input al servicio de generacion. La data del contexto (numeros del
 * grafico) se pasa como JSON grounded — el prompt template la formatea
 * como tabla legible para el LLM.
 */
export type GenerateInsightInput = {
  periodo: number;
  seccion: InsightSeccion;
  clienteSlug: string;
  entidadPropia: string;
  peerGroup: string[];
  /** Data especifica de la seccion (ver prompts/*.ts para shape esperado). */
  contexto: Record<string, unknown>;
};

/**
 * Payload interno pasado a los prompt templates.
 */
export type PromptContext = GenerateInsightInput & {
  periodoLabel: string;
  periodoAnterior: number;
  periodoAnteriorLabel: string;
};

/**
 * Resultado del generate — bullets + metadata para persistir/mostrar.
 */
export type GenerateInsightResult = {
  bullets: string[];
  model: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  durationMs: number;
  /** Si el resultado viene del cache, no cuenta contra rate limit. */
  fromCache: boolean;
};
