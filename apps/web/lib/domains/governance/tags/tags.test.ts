import { describe, expect, it } from "vitest";

import { COLUMN_TAG_VOCABULARY } from "./types";

describe("COLUMN_TAG_VOCABULARY (vocabulario canonico)", () => {
  it("cubre los 8 tags definidos en types.ts", () => {
    const expected = [
      "pii",
      "sensitive",
      "calculated",
      "deprecated",
      "experimental",
      "public",
      "regulatory",
      "financial",
    ].sort();
    const actual = COLUMN_TAG_VOCABULARY.map((t) => t.tag).sort();
    expect(actual).toEqual(expected);
  });

  it("toda entrada tiene label, description, color", () => {
    for (const entry of COLUMN_TAG_VOCABULARY) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(10);
      expect(["rose", "amber", "emerald", "slate", "violet", "sky"]).toContain(entry.color);
    }
  });

  it("no tiene tags duplicados", () => {
    const tags = COLUMN_TAG_VOCABULARY.map((e) => e.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});
