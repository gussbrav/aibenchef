/**
 * Tipos publicos del modulo SQL Workbench.
 */

export type SavedQuery = {
  id: string;
  userId: string;
  nombre: string;
  descripcion: string | null;
  sqlText: string;
  parametros: Record<string, unknown>;
  esPublico: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type QueryResult = {
  columnas: Array<{ key: string; tipo: string }>;
  filas: Array<Record<string, unknown>>;
  totalFilas: number;
  duracionMs: number;
  truncado: boolean;
};

export type QueryError = {
  message: string;
  hint?: string;
  position?: number;
};
