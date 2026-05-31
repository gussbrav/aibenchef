/**
 * Tipos publicos del subdominio governance/glossary.
 */

export type GlossaryCategory =
  | "financial"
  | "regulatory"
  | "ratio"
  | "calculated"
  | "dimension"
  | "metric"
  | "general";

export type GlossaryEntry = {
  id: string;
  schemaName: string;
  tableName: string;
  columnName: string | null; // null = entrada para la tabla completa
  displayName: string;
  description: string;
  ownerEmail: string | null;
  category: GlossaryCategory;
  appliesTo: string[]; // ej ['BANCOS','CMAC']
  formula: string | null;
  exampleUsage: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type GlossaryEntryInput = {
  schemaName: string;
  tableName: string;
  columnName?: string | null;
  displayName: string;
  description: string;
  ownerEmail?: string | null;
  category?: GlossaryCategory;
  appliesTo?: string[];
  formula?: string | null;
  exampleUsage?: string | null;
  source?: string | null;
};

export type GlossaryQuery = {
  schemaName?: string;
  tableName?: string;
  columnName?: string;
  category?: GlossaryCategory[];
  search?: string; // full-text en castellano
  limit?: number;
  offset?: number;
};

/**
 * PORT del glossary reader/writer. Separado en 2 interfaces (ISP):
 * routes/UI que solo leen no dependen de la habilidad de escribir.
 */
export interface GlossaryReader {
  /** Busca la entrada para una tabla o tabla+columna. NULL si no existe. */
  getEntry(schemaName: string, tableName: string, columnName?: string | null): Promise<GlossaryEntry | null>;

  /** Lista entradas con filtros. */
  list(filter: GlossaryQuery): Promise<GlossaryEntry[]>;

  /** Conteo (paginacion). */
  count(filter: Omit<GlossaryQuery, "limit" | "offset">): Promise<number>;
}

export interface GlossaryWriter {
  /** Inserta o updatea por (schema, table, column). Idempotente. */
  upsert(entry: GlossaryEntryInput, updatedBy: string): Promise<GlossaryEntry>;

  /** Borra una entrada. */
  remove(id: string): Promise<void>;
}
