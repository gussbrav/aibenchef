// Shared types for the Analisis Dinamico module.

export type FuentePivot = "balance" | "resultados" | "ratios";
export type AgregacionPivot = "NONE" | "SUM" | "AVG" | "MIN" | "MAX" | "COUNT";
export type Moneda = "MN" | "ME" | "TOTAL";

export type PivotColumna = {
  key: string;
  tipo: "dimension" | "medida";
  label: string;
  esNumerico: boolean;
};

export type ColumnasDisponibles = {
  dimensiones: PivotColumna[];
  medidas: PivotColumna[];
};

export type FiltrosPivot = {
  tipoEntidad?: string[];
  moneda?: Moneda[];
  nombCorreg?: string[];
  microfinanciera?: boolean;
  periodoDesde?: number;
  periodoHasta?: number;
};

export type FormatoCelda =
  | { tipo: "heatmap"; minColor?: string; maxColor?: string }
  | { tipo: "umbral"; bueno: number; malo: number };

export type PivotConfig = {
  fuente: FuentePivot;
  dimensiones: string[];
  medidas: string[];
  agregacion: AgregacionPivot;
  filtros: FiltrosPivot;
  formatoCondicional?: Record<string, FormatoCelda>;
};

export type PivotResultado = {
  columnas: PivotColumna[];
  filas: Array<Record<string, unknown>>;
  totalFilas: number;
  duracionMs: number;
};

export const DEFAULT_CONFIG: PivotConfig = {
  fuente: "balance",
  dimensiones: ["periodo", "nomb_correg"],
  // Por default usamos cuentas L2 que SIEMPRE tienen data (los totales L1
  // 'cta_a/b/c' fueron deprecated del MV hasta V026 — quedan como sintetizados).
  // A1 = DISPONIBLE, A4 = CREDITOS NETOS, B1 = OBLIGACIONES CON EL PUBLICO
  medidas: ["cta_a1", "cta_a4", "cta_b1"],
  agregacion: "NONE",
  filtros: {
    moneda: ["TOTAL"],
  },
};
