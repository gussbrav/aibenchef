import { describe, expect, it } from "vitest";

import { parseManifest } from "./dbt-manifest-reader";

describe("parseManifest", () => {
  it("convierte nodes simples a (nodes, edges)", () => {
    const manifest = {
      nodes: {
        "model.aibenchef.staging_raw": {
          resource_type: "model",
          schema: "staging",
          name: "raw",
          config: { materialized: "view" },
          depends_on: { nodes: ["source.aibenchef.raw.eeff_observacion"] },
        },
        "model.aibenchef.mart_balance": {
          resource_type: "model",
          schema: "marts",
          name: "mv_eeff_balance_ancho",
          config: { materialized: "table" },
          depends_on: { nodes: ["model.aibenchef.staging_raw"] },
        },
      },
      sources: {
        "source.aibenchef.raw.eeff_observacion": {
          resource_type: "source",
          schema: "raw",
          name: "eeff_observacion",
        },
      },
    };

    const result = parseManifest(manifest);

    expect(result.nodes).toHaveLength(3);
    const ids = result.nodes.map((n) => n.id).sort();
    expect(ids).toEqual([
      "marts.mv_eeff_balance_ancho",
      "raw.eeff_observacion",
      "staging.raw",
    ]);

    expect(result.edges).toHaveLength(2);
    const edgesKey = result.edges.map((e) => `${e.source}->${e.target}`).sort();
    expect(edgesKey).toEqual([
      "raw.eeff_observacion->staging.raw",
      "staging.raw->marts.mv_eeff_balance_ancho",
    ]);
  });

  it("ignora tests y exposures", () => {
    const manifest = {
      nodes: {
        "test.aibenchef.unique_id": {
          resource_type: "test",
          schema: "marts",
          name: "test_unique",
        },
        "exposure.aibenchef.dashboard_x": {
          resource_type: "exposure",
          schema: "exposures",
          name: "dashboard_x",
        },
        "model.aibenchef.real_model": {
          resource_type: "model",
          schema: "marts",
          name: "real",
        },
      },
    };
    const result = parseManifest(manifest);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe("marts.real");
  });

  it("maneja manifest sin sources", () => {
    const manifest = {
      nodes: {
        "model.x.y": {
          resource_type: "model",
          schema: "s",
          name: "y",
        },
      },
    };
    const result = parseManifest(manifest);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });

  it("deduplica nodos con mismo id", () => {
    const manifest = {
      nodes: {
        "model.a.x": { resource_type: "model", schema: "s", name: "y" },
        "model.b.x": { resource_type: "model", schema: "s", name: "y" },
      },
    };
    const result = parseManifest(manifest);
    expect(result.nodes).toHaveLength(1);
  });

  it("manifest vacio devuelve grafo vacio", () => {
    const result = parseManifest({ nodes: {} });
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});
