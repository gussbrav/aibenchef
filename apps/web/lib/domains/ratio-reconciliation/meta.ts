/**
 * Constantes y tipos client-safe del dominio ratio-reconciliation.
 * Sin "server-only" — se puede importar desde Client Components.
 * El modulo index.ts (server-only) re-exporta desde aqui.
 */

export type Indicador = "roa" | "roe" | "mora_atrasados_directos";

export type Severidad = "ok" | "leve" | "alto" | "critico" | "excluida";

export type DivergenceRow = {
  periodo: number;
  nombCorreg: string;
  indicador: Indicador;
  derivedValue: number;
  sbsValue: number;
  deltaBps: number;
  absDeltaBps: number;
  severidad: Severidad;
  sbsSeenAt: string | null;
  lastReconciledAt: string;
  notas: string | null;
  excluida: boolean;
  motivoExclusion: string | null;
};

export const INDICADOR_LABELS: Record<Indicador, string> = {
  roa: "ROA",
  roe: "ROE",
  mora_atrasados_directos: "Mora (Créditos Atrasados / Directos)",
};
