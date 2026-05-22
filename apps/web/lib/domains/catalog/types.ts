export type CatalogTabla = {
  schema: string;
  tabla: string;
  tipo: "table" | "view" | "materialized_view";
  comentario: string | null;
  filas: number | null;
};

export type CatalogColumna = {
  nombre: string;
  tipo: string;
  nullable: boolean;
  comentario: string | null;
  posicion: number;
};

export type CatalogTablaDetalle = CatalogTabla & {
  columnas: CatalogColumna[];
  sampleRows: Array<Record<string, unknown>>;
};
