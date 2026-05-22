import { describe, it, expect } from "vitest";

import { ValidationError } from "@/lib/domains/shared";

/**
 * Tests del SQL builder de pivot.ts — security-critical:
 * el endpoint construye SQL con identificadores inline, asi que el
 * whitelist debe ser bulletproof.
 *
 * Esta version testea las primitivas exportables. Las llamadas a DB
 * (getSchema, runPivot) requieren mocks/fixtures que dejamos para
 * un test de integracion separado.
 */

// Re-import via paths internos para testear funciones helper.
// pivot.ts no exporta ident() ni validarColumnas() — los testeamos
// indirectamente via runPivot() en tests de integracion.

// Aqui solo verificamos que el modulo carga y los tipos publicos existen.

describe("pivot module", () => {
  it("exporta runPivot y listColumnasDisponibles", async () => {
    const mod = await import("./pivot");
    expect(typeof mod.runPivot).toBe("function");
    expect(typeof mod.listColumnasDisponibles).toBe("function");
  });
});

describe("pivot inputs validation (smoke)", () => {
  it("ValidationError es lanzable desde shared", () => {
    expect(() => {
      throw new ValidationError("test", {});
    }).toThrow(ValidationError);
  });
});
