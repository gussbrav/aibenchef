/**
 * Adapter Postgres de los puertos LineageReader + LineageWriter.
 *
 * Lee/escribe sobre gov.lineage_snapshot. El "snapshot" se refresca
 * via scripts/refresh_lineage.ts despues de cada `dbt compile`.
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";

import type {
  LineageEdge,
  LineageGraph,
  LineageNode,
  LineageQuery,
  LineageReader,
  LineageWriter,
  LineageRelation,
} from "./types";

const NODE_LIST_LIMIT = 1000;

export class PostgresLineage implements LineageReader, LineageWriter {
  async getGraph(filter: LineageQuery): Promise<LineageGraph> {
    const upDepth = Math.max(0, Math.min(filter.upstreamDepth ?? 2, 5));
    const downDepth = Math.max(0, Math.min(filter.downstreamDepth ?? 2, 5));

    // Upstream: recursive CTE sobre edges donde target = focus
    const upstreamRows = await db.execute<{ source: string; target: string; relation: string }>(sql`
      WITH RECURSIVE up AS (
        SELECT source, target, relation, 1 AS depth
        FROM gov.lineage_snapshot
        WHERE target = ${filter.node}

        UNION

        SELECT e.source, e.target, e.relation, up.depth + 1
        FROM gov.lineage_snapshot e
        JOIN up ON e.target = up.source
        WHERE up.depth < ${upDepth}
      )
      SELECT DISTINCT source, target, relation FROM up
    `);

    const downstreamRows = await db.execute<{ source: string; target: string; relation: string }>(sql`
      WITH RECURSIVE down AS (
        SELECT source, target, relation, 1 AS depth
        FROM gov.lineage_snapshot
        WHERE source = ${filter.node}

        UNION

        SELECT e.source, e.target, e.relation, down.depth + 1
        FROM gov.lineage_snapshot e
        JOIN down ON e.source = down.target
        WHERE down.depth < ${downDepth}
      )
      SELECT DISTINCT source, target, relation FROM down
    `);

    const edges: LineageEdge[] = [];
    const seenEdge = new Set<string>();
    for (const row of [...upstreamRows, ...downstreamRows]) {
      const key = `${row.source}->${row.target}:${row.relation}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push({
        source: String(row.source),
        target: String(row.target),
        relation: row.relation as LineageRelation,
      });
    }

    // Coleccionar nodos unicos
    const nodeIds = new Set<string>([filter.node]);
    for (const e of edges) {
      nodeIds.add(e.source);
      nodeIds.add(e.target);
    }

    const nodes = await this.fetchNodes([...nodeIds]);

    return {
      focus: filter.node,
      nodes,
      edges,
    };
  }

  async listNodes(limit: number = NODE_LIST_LIMIT): Promise<LineageNode[]> {
    // Coleccionamos nodos como union de sources + targets distintos del snapshot.
    const rows = await db.execute<{ id: string }>(sql`
      SELECT DISTINCT id FROM (
        SELECT source AS id FROM gov.lineage_snapshot
        UNION
        SELECT target AS id FROM gov.lineage_snapshot
      ) s
      ORDER BY id
      LIMIT ${Math.min(limit, NODE_LIST_LIMIT)}
    `);
    return rows.map(toBareNode);
  }

  async replaceSnapshot(edges: LineageEdge[]): Promise<{ inserted: number }> {
    // Transaccional: borra + inserta atomicamente.
    let inserted = 0;
    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM gov.lineage_snapshot`);
      for (const e of edges) {
        await tx.execute(sql`
          INSERT INTO gov.lineage_snapshot (source, target, relation)
          VALUES (${e.source}, ${e.target}, ${e.relation})
          ON CONFLICT (target, source, relation) DO NOTHING
        `);
        inserted++;
      }
    });
    return { inserted };
  }

  private async fetchNodes(ids: string[]): Promise<LineageNode[]> {
    // El snapshot no guarda metadata por nodo (solo edges). Para V1 devolvemos
    // bare-bone derivado del id. Cuando agreguemos tabla gov.lineage_nodes
    // con metadata, ampliar aca.
    return ids.map((id) => toBareNode({ id }));
  }
}

function toBareNode({ id }: { id: string }): LineageNode {
  const [schema, ...rest] = id.split(".");
  return {
    id,
    schema: schema ?? "",
    name: rest.join(".") || id,
  };
}
