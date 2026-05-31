import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryAuditLogger } from "./in-memory-audit-logger";
import type { AuditEventInput } from "./types";

describe("InMemoryAuditLogger (cumple puerto AuditLogger)", () => {
  let logger: InMemoryAuditLogger;

  beforeEach(() => {
    logger = new InMemoryAuditLogger();
  });

  it("log() acepta evento minimo y aplica defaults", async () => {
    await logger.log({ category: "auth", action: "login" });
    const all = logger.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.severity).toBe("info");
    expect(all[0]?.source).toBe("api");
    expect(all[0]?.metadata).toEqual({});
  });

  it("log() preserva todos los campos opcionales", async () => {
    const event: AuditEventInput = {
      category: "data_access",
      action: "sql_query",
      severity: "warn",
      actorId: "user-1",
      actorEmail: "gus@example.com",
      tenantId: "00000000-0000-0000-0000-000000000001",
      resource: "marts.mv_eeff_balance_ancho",
      metadata: { rows: 1234, ms: 89 },
      source: "api",
      traceId: "trace-abc",
    };
    await logger.log(event);
    const stored = logger.all()[0]!;
    expect(stored.actorEmail).toBe("gus@example.com");
    expect(stored.tenantId).toBe("00000000-0000-0000-0000-000000000001");
    expect(stored.metadata).toEqual({ rows: 1234, ms: 89 });
  });

  it("query() filtra por category", async () => {
    await logger.log({ category: "auth", action: "login" });
    await logger.log({ category: "data_access", action: "sql_query" });
    await logger.log({ category: "billing", action: "charge_success" });

    const result = await logger.query({ categories: ["auth", "billing"] });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.category !== "data_access")).toBe(true);
  });

  it("query() filtra por actorId", async () => {
    await logger.log({ category: "auth", action: "login", actorId: "u1" });
    await logger.log({ category: "auth", action: "login", actorId: "u2" });

    const result = await logger.query({ actorId: "u1" });
    expect(result).toHaveLength(1);
    expect(result[0]?.actorId).toBe("u1");
  });

  it("query() filtra por severity", async () => {
    await logger.log({ category: "auth", action: "login", severity: "info" });
    await logger.log({ category: "auth", action: "failed", severity: "warn" });
    await logger.log({ category: "auth", action: "boom", severity: "critical" });

    const result = await logger.query({ severity: ["warn", "critical"] });
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.severity).sort()).toEqual(["critical", "warn"]);
  });

  it("query() respeta limit y offset", async () => {
    for (let i = 0; i < 10; i++) {
      await logger.log({ category: "auth", action: `evt-${i}` });
    }
    const page1 = await logger.query({ limit: 3, offset: 0 });
    const page2 = await logger.query({ limit: 3, offset: 3 });

    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(3);
    expect(page1[0]?.action).not.toBe(page2[0]?.action);
  });

  it("count() devuelve total sin paginar", async () => {
    for (let i = 0; i < 5; i++) {
      await logger.log({ category: "auth", action: `e-${i}` });
    }
    for (let i = 0; i < 3; i++) {
      await logger.log({ category: "billing", action: `b-${i}` });
    }

    expect(await logger.count({})).toBe(8);
    expect(await logger.count({ categories: ["auth"] })).toBe(5);
    expect(await logger.count({ categories: ["billing"] })).toBe(3);
  });

  it("query() ordena por occurredAt DESC", async () => {
    await logger.log({ category: "auth", action: "first" });
    // Forzar tiempo distinto
    await new Promise((r) => setTimeout(r, 2));
    await logger.log({ category: "auth", action: "second" });

    const result = await logger.query({});
    expect(result[0]?.action).toBe("second");
    expect(result[1]?.action).toBe("first");
  });

  it("query() resourcePattern soporta LIKE %", async () => {
    await logger.log({ category: "data_access", action: "query", resource: "marts.mv_eeff_balance" });
    await logger.log({ category: "data_access", action: "query", resource: "marts.mv_colocaciones" });
    await logger.log({ category: "data_access", action: "query", resource: "raw.archivos" });

    const result = await logger.query({ resourcePattern: "marts.%" });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.resource?.startsWith("marts."))).toBe(true);
  });

  it("clear() resetea el store", async () => {
    await logger.log({ category: "auth", action: "login" });
    expect(logger.all()).toHaveLength(1);
    logger.clear();
    expect(logger.all()).toHaveLength(0);
  });
});
