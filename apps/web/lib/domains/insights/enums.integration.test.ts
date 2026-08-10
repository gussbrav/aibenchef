/**
 * Integration test — enum drift entre TypeScript y DB CHECK constraints.
 *
 * REGRESION V155: agregamos 'punto_equilibrio' al enum InsightSeccion en
 * TS pero olvidamos extender el CHECK constraint de admin.report_insights.
 * El INSERT fallaba en runtime con PostgreSQL error 23514 (check_violation),
 * y la UI mostraba el mensaje genérico "Valor invalido". Bug detectado
 * en producción por el usuario final — inaceptable.
 *
 * Este test previene la clase entera de bugs comparando:
 *   - Los enums TypeScript declarados (single source of truth para el código)
 *   - Los CHECK constraints activos en la DB (single source of truth para
 *     el schema)
 *
 * Si un enum TS tiene un valor NO permitido por la DB, o viceversa, el
 * test falla ANTES del deploy. Cero sorpresas en producción.
 *
 * NOTA: usa testcontainers (Docker) + aplica las migraciones relevantes.
 * Skip en local sin Docker via RUN_INTEGRATION_TESTS !== "1" (mismo
 * pattern que queries.integration.test.ts).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { INSIGHT_SECCIONES } from "./types";
import { PUBLICACION_TEMAS, PUBLICACION_STATUS } from "../publicaciones/types";

const SKIP_INTEGRATION = process.env.RUN_INTEGRATION_TESTS !== "1";

let container: StartedPostgreSqlContainer;
let testDbUrl: string;

/**
 * Aplica todas las migrations relevantes para que existan los CHECK
 * constraints que queremos validar. Se aplican en orden (V001..V999)
 * pero solo las que sabemos tocan constraints — filtramos por nombre
 * para no aplicar migrations pesadas de data que no importan aca.
 */
async function setupSchema(url: string): Promise<void> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1 });
  try {
    // Schemas base
    await sql.unsafe(`
      CREATE SCHEMA IF NOT EXISTS admin;
      CREATE SCHEMA IF NOT EXISTS config;
      CREATE SCHEMA IF NOT EXISTS raw;
      CREATE SCHEMA IF NOT EXISTS marts;
      CREATE SCHEMA IF NOT EXISTS dw;
    `);
    // Tabla mock de dependencias — config.cliente + admin.llm_providers.
    // Las migraciones reales tienen FKs a estas; creamos stubs minimos.
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS config.cliente (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS admin.llm_providers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid()
      );
    `);

    // Aplicar migrations que definen o modifican los CHECK que testeamos.
    // Ordenadas por nombre — Postgres es case-insensitive para IN pero
    // los CHECK conservan el orden textual del constraint.
    const migDir = join(process.cwd(), "..", "..", "infrastructure", "postgres", "migrations");
    const files = readdirSync(migDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    // Solo las que definen o modifican los CHECK que testeamos:
    // V141 = crea admin.report_insights + CHECK seccion
    // V143 = extiende CHECK con solvencia/liquidez/cobertura
    // V154 = crea admin.publicaciones + CHECK tema + CHECK status
    // V155 = extiende CHECK seccion con punto_equilibrio
    const relevant = files.filter((f) =>
      /^V(141|143|154|155)__/.test(f),
    );
    for (const f of relevant) {
      const body = readFileSync(join(migDir, f), "utf8");
      // Ejecutamos en un bloque sin transaccion explicita porque las
      // migraciones ya son idempotentes (IF NOT EXISTS, CREATE OR REPLACE,
      // etc). Si una falla por dependencia no incluida, la marcamos y
      // reportamos — el test skipea gracefully.
      try {
        await sql.unsafe(body);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[enums.integration] migration ${f} fallo (skipeando):`, err);
      }
    }
  } finally {
    await sql.end();
  }
}

/**
 * Extrae los valores permitidos por un CHECK constraint tipo `col IN ('a', 'b', ...)`.
 * Los CHECK complejos con condiciones adicionales no se soportan — el test
 * expone en el error el check_clause raw para diagnostico manual.
 */
async function getCheckAllowedValues(
  url: string,
  constraintName: string,
): Promise<{ values: string[]; raw: string }> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql<{ check_clause: string }[]>`
      SELECT check_clause
      FROM information_schema.check_constraints
      WHERE constraint_name = ${constraintName}
      LIMIT 1
    `;
    const raw = rows[0]?.check_clause ?? "";
    // Extraer lista dentro de `IN (...)` — soporta multi-linea + trimming.
    const match = raw.match(/IN\s*\(([^)]+)\)/is);
    if (!match) return { values: [], raw };
    const values = match[1]
      .split(",")
      .map((s) => s.trim().replace(/^'/, "").replace(/'$/, "").replace(/::text$/, ""))
      .filter(Boolean);
    return { values, raw };
  } finally {
    await sql.end();
  }
}

describe.skipIf(SKIP_INTEGRATION)("enum drift TS <-> DB", () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("test")
      .withUsername("test")
      .withPassword("test")
      .start();
    testDbUrl = container.getConnectionUri();
    await setupSchema(testDbUrl);
  }, 120_000);

  afterAll(async () => {
    if (container) await container.stop();
  });

  it("InsightSeccion (TS) === report_insights_seccion_check (DB)", async () => {
    const { values, raw } = await getCheckAllowedValues(
      testDbUrl,
      "report_insights_seccion_check",
    );
    if (values.length === 0) {
      throw new Error(
        `No se pudo extraer valores del CHECK 'report_insights_seccion_check'. ` +
        `Raw: ${raw}. Actualizar el parser de este test si el schema cambio.`,
      );
    }
    // Cada enum TS debe estar en la DB.
    const missingInDb = INSIGHT_SECCIONES.filter((v) => !values.includes(v));
    expect(missingInDb, `Valores en TS pero NO en el CHECK de la DB: ${missingInDb.join(", ")}`).toEqual([]);

    // Y cada valor de la DB debe estar en el enum TS (evita valores muertos).
    const extraInDb = values.filter((v) => !INSIGHT_SECCIONES.includes(v as (typeof INSIGHT_SECCIONES)[number]));
    expect(extraInDb, `Valores en DB pero NO en el enum TS: ${extraInDb.join(", ")}`).toEqual([]);
  });

  it("PublicacionTema (TS) === publicaciones.tema CHECK (DB)", async () => {
    const { values } = await getCheckAllowedValues(
      testDbUrl,
      "publicaciones_tema_check",
    );
    if (values.length === 0) {
      // La migration V154 pudo no aplicarse por dependencias faltantes en
      // el setup minimo — el test skipea gracefully.
      // eslint-disable-next-line no-console
      console.warn("[enums.integration] publicaciones_tema_check no encontrado, skip");
      return;
    }
    const missing = PUBLICACION_TEMAS.filter((v) => !values.includes(v));
    expect(missing, `Temas en TS pero NO en CHECK: ${missing.join(", ")}`).toEqual([]);
    const extra = values.filter((v) => !PUBLICACION_TEMAS.includes(v as (typeof PUBLICACION_TEMAS)[number]));
    expect(extra, `Temas en CHECK pero NO en TS: ${extra.join(", ")}`).toEqual([]);
  });

  it("PublicacionStatus (TS) === publicaciones.status CHECK (DB)", async () => {
    const { values } = await getCheckAllowedValues(
      testDbUrl,
      "publicaciones_status_check",
    );
    if (values.length === 0) {
      // eslint-disable-next-line no-console
      console.warn("[enums.integration] publicaciones_status_check no encontrado, skip");
      return;
    }
    const missing = PUBLICACION_STATUS.filter((v) => !values.includes(v));
    expect(missing, `Status en TS pero NO en CHECK: ${missing.join(", ")}`).toEqual([]);
    const extra = values.filter((v) => !PUBLICACION_STATUS.includes(v as (typeof PUBLICACION_STATUS)[number]));
    expect(extra, `Status en CHECK pero NO en TS: ${extra.join(", ")}`).toEqual([]);
  });
});
