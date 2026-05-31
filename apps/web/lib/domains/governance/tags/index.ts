export type {
  ColumnTag,
  ColumnTagDescription,
  ColumnTagEntry,
  ColumnTagInput,
  ColumnTagQuery,
  ColumnTagService,
} from "./types";

export { COLUMN_TAG_VOCABULARY } from "./types";

import { PostgresColumnTagService } from "./postgres-tag-service";
import type { ColumnTagService } from "./types";

export { PostgresColumnTagService } from "./postgres-tag-service";

let _instance: ColumnTagService | null = null;

export function getColumnTagService(): ColumnTagService {
  if (_instance === null) _instance = new PostgresColumnTagService();
  return _instance;
}

export function setColumnTagService(impl: ColumnTagService | null): void {
  _instance = impl;
}
