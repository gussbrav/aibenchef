/**
 * Tipos del subdominio entity-profiles.
 *
 * Un EntityProfile es la "ficha" de una entidad financiera o COOPAC —
 * datos de contexto que la data SBS no contiene (ubicacion, publico
 * objetivo, modelo de negocio, segmento de cartera) pero que son
 * criticos para que el LLM no invente ni se disculpe por falta de contexto.
 */

export type ModeloNegocio = "cerrada" | "abierta" | "mixta" | "desconocido";

/**
 * Shape persistido en gov.entity_profiles.
 */
export interface EntityProfile {
  nombCorreg: string;
  tipoEntidad: string | null;
  ubicacion: string | null;
  inicioOperaciones: string | null;
  rucSunat: string | null;
  publicoObjetivo: string | null;
  modeloNegocio: ModeloNegocio | null;
  segmentoCarteraHipotesis: string | null;
  productosPrincipales: string | null;
  notas: string | null;
  fuentes: string[];

  researchAt: string | null;
  researchModel: string | null;
  researchCostUsd: number;
  researchCount: number;

  verifiedByHuman: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;

  useCount: number;
  lastUsedAt: string | null;

  createdAt: string;
  updatedAt: string;
}

/**
 * Shape que devuelve el research service (lo que el LLM extrae via web_search).
 * Todos los campos son opcionales — si el LLM no puede determinar un dato,
 * lo deja null en vez de inventarlo.
 */
export interface EntityProfileResearchResult {
  ubicacion: string | null;
  inicioOperaciones: string | null;
  rucSunat: string | null;
  publicoObjetivo: string | null;
  modeloNegocio: ModeloNegocio | null;
  segmentoCarteraHipotesis: string | null;
  productosPrincipales: string | null;
  notas: string | null;
  fuentes: string[];
}

/**
 * Metadata del research (costo + modelo usado).
 */
export interface ResearchMetadata {
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface ResearchResult {
  profile: EntityProfileResearchResult;
  metadata: ResearchMetadata;
}

/**
 * Snapshot del estado del rate limiter global.
 */
export interface RateLimitStatus {
  fechaUtc: string;
  researchCount: number;
  dailyLimit: number;
  remaining: number;
  allowed: boolean;
  totalCostUsd: number;
}
