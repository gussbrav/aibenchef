import { describe, it, expect } from "vitest";

import { validateSql } from "./sandbox";
import { ValidationError } from "@/lib/domains/shared";

/**
 * Tests del validador SQL.
 *
 * Es codigo SECURITY-CRITICAL: cada caso negativo aqui es una capa de
 * defensa que evita un acceso indebido.
 */

describe("validateSql — happy paths", () => {
  it("acepta SELECT simple", () => {
    expect(() => validateSql("SELECT * FROM marts.mv_eeff_ratios")).not.toThrow();
  });

  it("acepta SELECT con WHERE y JOIN", () => {
    expect(() =>
      validateSql(
        "SELECT a.nomb_correg, a.utilidad_neta FROM marts.mv_eeff_ratios a WHERE a.moneda = 'TOTAL' AND a.periodo = 202603",
      ),
    ).not.toThrow();
  });

  it("acepta WITH (CTE)", () => {
    expect(() =>
      validateSql(
        "WITH t AS (SELECT * FROM marts.mv_eeff_ratios WHERE moneda='TOTAL') SELECT * FROM t LIMIT 10",
      ),
    ).not.toThrow();
  });

  it("acepta query con punto y coma al final", () => {
    expect(() => validateSql("SELECT 1;")).not.toThrow();
  });

  it("acepta comentarios -- y /* */", () => {
    expect(() =>
      validateSql("-- comentario\nSELECT 1 /* otro comentario */ FROM marts.mv_eeff_ratios"),
    ).not.toThrow();
  });
});

describe("validateSql — DDL prohibido", () => {
  const ddl = [
    "DROP TABLE auth.users",
    "CREATE TABLE foo (id int)",
    "ALTER TABLE marts.mv_eeff_ratios DROP COLUMN periodo",
    "TRUNCATE TABLE auth.users",
  ];
  for (const sql of ddl) {
    it(`rechaza: ${sql}`, () => {
      expect(() => validateSql(sql)).toThrow(ValidationError);
    });
  }
});

describe("validateSql — DML prohibido", () => {
  const dml = [
    "INSERT INTO auth.users (id) VALUES ('1')",
    "UPDATE auth.users SET email = 'x'",
    "DELETE FROM auth.users",
    "MERGE INTO foo USING bar ON foo.id = bar.id WHEN MATCHED THEN UPDATE SET x = 1",
  ];
  for (const sql of dml) {
    it(`rechaza: ${sql}`, () => {
      expect(() => validateSql(sql)).toThrow(ValidationError);
    });
  }
});

describe("validateSql — multi statement", () => {
  it("rechaza ; en medio", () => {
    expect(() => validateSql("SELECT 1; SELECT 2")).toThrow(ValidationError);
  });
  it("rechaza UNION con DROP", () => {
    expect(() =>
      validateSql("SELECT 1 UNION SELECT 2; DROP TABLE auth.users"),
    ).toThrow(ValidationError);
  });
});

describe("validateSql — schemas prohibidos", () => {
  it("rechaza SELECT desde auth.users", () => {
    expect(() => validateSql("SELECT * FROM auth.users")).toThrow(ValidationError);
  });
  it("rechaza referencia a raw.eeff_observacion", () => {
    expect(() => validateSql("SELECT * FROM raw.eeff_observacion")).toThrow(
      ValidationError,
    );
  });
  it("rechaza app.workspaces_analisis", () => {
    expect(() => validateSql("SELECT * FROM app.workspaces_analisis")).toThrow(
      ValidationError,
    );
  });
});

describe("validateSql — comandos sensibles", () => {
  const sensibles = [
    "GRANT ALL ON marts.mv_eeff_ratios TO public",
    "REVOKE SELECT ON marts.mv_eeff_ratios FROM app_sql_readonly",
    "COPY marts.mv_eeff_ratios TO '/tmp/out.csv'",
    "VACUUM marts.mv_eeff_ratios",
    "SET search_path TO public",
    "EXPLAIN SELECT * FROM marts.mv_eeff_ratios",
  ];
  for (const sql of sensibles) {
    it(`rechaza: ${sql}`, () => {
      expect(() => validateSql(sql)).toThrow(ValidationError);
    });
  }
});

describe("validateSql — limites", () => {
  it("rechaza vacio", () => {
    expect(() => validateSql("")).toThrow(ValidationError);
    expect(() => validateSql("   ")).toThrow(ValidationError);
  });

  it("rechaza > 50K chars", () => {
    expect(() => validateSql("SELECT 1 " + "/* x */".repeat(8000))).toThrow(
      ValidationError,
    );
  });

  it("rechaza que no empiece con SELECT/WITH", () => {
    expect(() => validateSql("SHOW search_path")).toThrow(ValidationError);
  });
});

describe("validateSql — bypass attempts conocidos", () => {
  it("rechaza inyeccion via comentario", () => {
    // El comentario se quita pero el resto debe seguir siendo SELECT-only
    expect(() =>
      validateSql("SELECT 1 /* */; DROP TABLE auth.users -- */"),
    ).toThrow(ValidationError);
  });

  it("rechaza encoded keyword", () => {
    // No protegemos contra SQL hex/unicode obfuscation. Si esto fuera
    // ejecutado por app_sql_readonly igual fallaria. Doc explicito.
    // Aqui solo aseguramos que el filtro literal funciona.
    expect(() => validateSql("SELECT 1; INSERT INTO x VALUES (1)")).toThrow(
      ValidationError,
    );
  });
});
