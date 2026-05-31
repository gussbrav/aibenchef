/**
 * Lector del dbt manifest.json — extrae edges del DAG.
 *
 * NO es un adapter del puerto LineageReader. Es una utility que produce
 * los edges para alimentar a un Writer (que los persiste).
 *
 * Por que: dbt genera el manifest cada vez que corre `dbt compile`. Ese
 * archivo tiene el grafo completo en formato estructurado. Lo
 * convertimos a nuestro modelo y lo guardamos.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { LineageEdge, LineageNode } from "./types";

/**
 * Subset minimo del manifest dbt que necesitamos.
 */
type DbtManifest = {
  nodes: Record<
    string,
    {
      resource_type: string;
      schema: string;
      name: string;
      database?: string;
      depends_on?: { nodes?: string[] };
      config?: { materialized?: string };
    }
  >;
  sources?: Record<
    string,
    {
      resource_type: string;
      schema: string;
      name: string;
      database?: string;
    }
  >;
};

export type ParsedManifest = {
  nodes: LineageNode[];
  edges: LineageEdge[];
};

/**
 * Convierte el manifest a (nodes, edges) en nuestro modelo.
 *
 * Reglas:
 * - Cada `nodes`/`sources` del manifest se convierte a un LineageNode.
 * - Cada `depends_on.nodes` se convierte en un LineageEdge directo.
 * - Sources se incluyen como nodos (resource_type='source').
 * - Tests y exposures se ignoran (no son data lineage real).
 */
export function parseManifest(manifest: DbtManifest): ParsedManifest {
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];

  // Mapeo dbt_id -> our_id (schema.table)
  const idMap = new Map<string, string>();

  const collect = (
    entries: DbtManifest["nodes"] | DbtManifest["sources"] | undefined,
  ): void => {
    if (!entries) return;
    for (const [dbtId, node] of Object.entries(entries)) {
      if (node.resource_type === "test" || node.resource_type === "exposure") continue;
      const ourId = `${node.schema}.${node.name}`;
      idMap.set(dbtId, ourId);
      nodes.push({
        id: ourId,
        schema: node.schema,
        name: node.name,
        resourceType: node.resource_type,
        materialization: ("config" in node ? node.config?.materialized : undefined) ?? undefined,
      });
    }
  };

  collect(manifest.nodes);
  collect(manifest.sources);

  // Edges
  for (const [dbtId, node] of Object.entries(manifest.nodes ?? {})) {
    const target = idMap.get(dbtId);
    if (!target) continue;
    const deps = node.depends_on?.nodes ?? [];
    for (const dep of deps) {
      const source = idMap.get(dep);
      if (!source) continue;
      edges.push({ source, target, relation: "direct" });
    }
  }

  // Deduplicar nodos por id (sources y models pueden colisionar en raros casos)
  const seen = new Set<string>();
  const uniqueNodes = nodes.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });

  return { nodes: uniqueNodes, edges };
}

/**
 * Lee el manifest desde un path en disco.
 *
 * Path tipico (relativo al repo): data-platform/dbt/target/manifest.json
 */
export async function readManifestFromDisk(manifestPath: string): Promise<DbtManifest> {
  const abs = path.resolve(manifestPath);
  const content = await fs.readFile(abs, "utf-8");
  return JSON.parse(content) as DbtManifest;
}
