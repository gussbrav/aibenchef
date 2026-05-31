export type {
  GlossaryCategory,
  GlossaryEntry,
  GlossaryEntryInput,
  GlossaryQuery,
  GlossaryReader,
  GlossaryWriter,
} from "./types";

import { PostgresGlossary } from "./postgres-glossary";
import type { GlossaryReader, GlossaryWriter } from "./types";

export { PostgresGlossary } from "./postgres-glossary";
export { CANONICAL_GLOSSARY_SEED } from "./seed";

let _instance: (GlossaryReader & GlossaryWriter) | null = null;

export function getGlossary(): GlossaryReader & GlossaryWriter {
  if (_instance === null) _instance = new PostgresGlossary();
  return _instance;
}

export function setGlossary(impl: (GlossaryReader & GlossaryWriter) | null): void {
  _instance = impl;
}
