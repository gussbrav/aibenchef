/**
 * Tipos publicos del subdominio governance/lineage.
 *
 * Modela el grafo dirigido (DAG) de dependencias entre tablas/vistas del DWH.
 * El grafo se extrae del dbt manifest.json (no se infiere de queries en
 * runtime, lo cual seria caro y ruidoso).
 */

export type LineageRelation = "direct" | "indirect";

export type LineageNode = {
  /** Nombre completo del nodo: 'schema.table'. */
  id: string;
  /** Schema separado (denormalizado para queries). */
  schema: string;
  /** Nombre de la tabla/vista. */
  name: string;
  /** dbt resource_type cuando proviene de dbt: 'model', 'seed', 'source', 'snapshot'. */
  resourceType?: string;
  /** Materializacion dbt: 'table', 'view', 'incremental', 'ephemeral'. */
  materialization?: string;
};

export type LineageEdge = {
  source: string; // id del nodo source
  target: string; // id del nodo target
  relation: LineageRelation;
};

/**
 * Resultado de una query de lineage centrada en un nodo. Incluye N saltos
 * upstream y downstream.
 */
export type LineageGraph = {
  /** Nodo central de la query. */
  focus: string;
  /** Nodos descubiertos (focus + upstream + downstream). */
  nodes: LineageNode[];
  /** Edges del grafo. */
  edges: LineageEdge[];
};

export type LineageQuery = {
  /** Nodo focus (schema.table). */
  node: string;
  /** N de saltos hacia atras (sources). Default 2. */
  upstreamDepth?: number;
  /** N de saltos hacia adelante (consumers). Default 2. */
  downstreamDepth?: number;
};

/**
 * PORT del lineage reader. Adapter principal lee de gov.lineage_snapshot.
 * Adapter alternativo (futuro) podria leer manifest.json directamente.
 */
export interface LineageReader {
  /** Devuelve grafo focalizado segun query. */
  getGraph(filter: LineageQuery): Promise<LineageGraph>;

  /** Lista de todos los nodos para autocomplete. */
  listNodes(limit?: number): Promise<LineageNode[]>;
}

/**
 * PORT del lineage writer. Para refresh del snapshot desde dbt manifest.
 */
export interface LineageWriter {
  /** Reemplaza el snapshot con nuevos edges. Transaccional. */
  replaceSnapshot(edges: Omit<LineageEdge, never>[]): Promise<{ inserted: number }>;
}
