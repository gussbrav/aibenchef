/**
 * Tipos publicos del dominio workspaces (vistas guardadas de Analisis Dinamico).
 */

export type WorkspaceAnalisisConfig = {
  fuente: "balance" | "resultados" | "ratios";
  dimensiones: string[];
  medidas: string[];
  agregacion: "NONE" | "SUM" | "AVG" | "MIN" | "MAX" | "COUNT";
  filtros?: {
    tipoEntidad?: string[];
    moneda?: string[];
    nombCorreg?: string[];
    microfinanciera?: boolean;
    periodoDesde?: number;
    periodoHasta?: number;
  };
  formatoCondicional?: Record<
    string,
    {
      tipo: "heatmap" | "umbral";
      minColor?: string;
      maxColor?: string;
      umbralBueno?: number;
      umbralMalo?: number;
    }
  >;
  charts?: Array<{
    tipo: "line" | "bar" | "scatter";
    x: string;
    y: string[];
    seriesBy?: string;
    titulo?: string;
  }>;
};

export type WorkspaceAnalisis = {
  id: string;
  userId: string;
  nombre: string;
  descripcion: string | null;
  config: WorkspaceAnalisisConfig;
  esDefault: boolean;
  esPublico: boolean;
  createdAt: string;
  updatedAt: string;
};
