export type {
  LineageEdge,
  LineageGraph,
  LineageNode,
  LineageQuery,
  LineageReader,
  LineageRelation,
  LineageWriter,
} from "./types";

import { PostgresLineage } from "./postgres-lineage";
import type { LineageReader, LineageWriter } from "./types";

export { PostgresLineage } from "./postgres-lineage";
export { parseManifest, readManifestFromDisk } from "./dbt-manifest-reader";

let _instance: (LineageReader & LineageWriter) | null = null;

export function getLineage(): LineageReader & LineageWriter {
  if (_instance === null) _instance = new PostgresLineage();
  return _instance;
}

export function setLineage(impl: (LineageReader & LineageWriter) | null): void {
  _instance = impl;
}
