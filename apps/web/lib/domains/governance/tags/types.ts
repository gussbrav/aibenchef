/**
 * Tipos publicos del subdominio governance/tags.
 *
 * Vocabulario canonico fijo — los tags son enum, no free-text.
 * Agregar tag nuevo requiere migration + actualizar este enum + docs.
 */

export type ColumnTag =
  | "pii"
  | "sensitive"
  | "calculated"
  | "deprecated"
  | "experimental"
  | "public"
  | "regulatory"
  | "financial";

export type ColumnTagDescription = {
  tag: ColumnTag;
  label: string;
  description: string;
  color: "rose" | "amber" | "emerald" | "slate" | "violet" | "sky";
};

/**
 * Vocabulario canonico con descripciones humanas.
 * UI lo usa para mostrar leyenda y validar tags.
 */
export const COLUMN_TAG_VOCABULARY: ColumnTagDescription[] = [
  {
    tag: "pii",
    label: "PII",
    description: "Personally Identifiable Information. Email, DNI, telefono, direccion.",
    color: "rose",
  },
  {
    tag: "sensitive",
    label: "Sensible",
    description: "Datos confidenciales no-PII (financial-confidential, internal-only).",
    color: "amber",
  },
  {
    tag: "calculated",
    label: "Calculado",
    description: "Valor derivado de otras columnas (ratio, agregado, formula).",
    color: "violet",
  },
  {
    tag: "deprecated",
    label: "Deprecated",
    description: "Sera eliminado. NO usar en codigo nuevo.",
    color: "slate",
  },
  {
    tag: "experimental",
    label: "Experimental",
    description: "Puede cambiar sin aviso. NO usar en producto cliente.",
    color: "amber",
  },
  {
    tag: "public",
    label: "Publico",
    description: "Data publica regulatoria (SBS) — sin restricciones de acceso.",
    color: "emerald",
  },
  {
    tag: "regulatory",
    label: "Regulatorio",
    description: "Cifra reportable a SBS. Cambiar interpretacion requiere ADR.",
    color: "sky",
  },
  {
    tag: "financial",
    label: "Financiero",
    description: "Cifras monetarias del Balance, ER o ratios financieros.",
    color: "emerald",
  },
];

export type ColumnTagEntry = {
  id: string;
  schemaName: string;
  tableName: string;
  columnName: string;
  tag: ColumnTag;
  note: string | null;
  setBy: string | null;
  setAt: string;
};

export type ColumnTagInput = {
  schemaName: string;
  tableName: string;
  columnName: string;
  tag: ColumnTag;
  note?: string | null;
};

export type ColumnTagQuery = {
  schemaName?: string;
  tableName?: string;
  columnName?: string;
  tags?: ColumnTag[];
  limit?: number;
};

export interface ColumnTagService {
  add(input: ColumnTagInput, setBy: string): Promise<ColumnTagEntry>;
  remove(id: string): Promise<void>;
  list(filter: ColumnTagQuery): Promise<ColumnTagEntry[]>;
  listForColumn(
    schemaName: string,
    tableName: string,
    columnName: string,
  ): Promise<ColumnTagEntry[]>;
}
