/**
 * Types del subdominio macro-context.
 *
 * Un MacroContextItem es un evento macro vigente (Niño, tasa BCR, circular
 * SBS, etc.) que se inyecta a los analisis de IA como contexto vivo.
 */

export type MacroCategoria =
  | "climatico"
  | "macro"
  | "politico"
  | "regulatorio"
  | "sectorial";

export type MacroSeveridad = "alta" | "media" | "baja" | "informativo";

export interface MacroContextItem {
  id: string;
  snapshotAt: string;
  categoria: MacroCategoria;
  titulo: string;
  resumen: string;
  impacto: string | null;
  severidad: MacroSeveridad;
  vigenteHasta: string | null;
  fuentes: string[];
  researchModel: string | null;
  researchCostUsd: number;
  verifiedByHuman: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Item que devuelve el research (shape del JSON del LLM).
 */
export interface MacroResearchItem {
  categoria: MacroCategoria;
  titulo: string;
  resumen: string;
  impacto: string | null;
  severidad: MacroSeveridad;
  vigente_hasta: string | null;
  fuentes: string[];
}

export interface MacroResearchResult {
  items: MacroResearchItem[];
  metadata: {
    model: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  };
}

export interface MacroRefreshResult {
  logId: string;
  itemsCreated: number;
  itemsUpdated: number;
  itemsExpired: number;
  costUsd: number;
  status: "ok" | "failed";
  error?: string;
}
