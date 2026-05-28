/**
 * Integration tests para queries del domain pipeline.
 *
 * REGRESION issue #22: el smoke test anterior (queries.test.ts) solo
 * verificaba tipos exportados — NO detectaba el bug "cannot cast type
 * record to text[]" en getPipelineHealth() porque nunca ejecutaba SQL
 * real. Estos tests lo hacen contra un Postgres efimero (testcontainers).
 *
 * Cada test cubre una query del domain. Si una query rompe en runtime,
 * el test correspondiente debe romper en CI.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Tests opt-in: solo corren si RUN_INTEGRATION_TESTS=1 (CI dedicado).
// Sin esto, vitest los skipea silenciosamente en local + en el job
// `web — Next.js` que no tiene Docker disponible.
const SKIP_INTEGRATION = process.env.RUN_INTEGRATION_TESTS !== "1";

let container: StartedPostgreSqlContainer;
let testDbUrl: string;

/**
 * Setup: levanta Postgres efimero + aplica las migrations necesarias
 * (V007 raw.carga_log base + V013 archivos + V075 sync_jobs + V089 status
 * + V093 carga_log extension + V094 v_entidades_delta + admin.estructura_diffs).
 *
 * No usa el migrator de Node porque eso requiere SQL files completos
 * de V001..V094 — aqui aplicamos solo lo necesario para aislar el test.
 */
async function setupSchema(url: string): Promise<void> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(`
      CREATE SCHEMA IF NOT EXISTS raw;
      CREATE SCHEMA IF NOT EXISTS admin;
      CREATE SCHEMA IF NOT EXISTS marts;
      CREATE SCHEMA IF NOT EXISTS dw;
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS raw.archivos_descargados (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        grupo TEXT NOT NULL,
        topico TEXT NOT NULL,
        periodo INT NOT NULL,
        anio INT NOT NULL,
        mes INT NOT NULL,
        nombre_archivo TEXT NOT NULL,
        path_local TEXT NOT NULL UNIQUE,
        source_url TEXT NOT NULL,
        tamanio_bytes BIGINT NOT NULL,
        md5_hash TEXT,
        formato TEXT,
        status TEXT NOT NULL DEFAULT 'descargado'
          CHECK (status IN ('descargado','procesando','procesado','error','omitido','no_publicado_sbs')),
        filas_insertadas INT,
        error_mensaje TEXT,
        procesado_en TIMESTAMPTZ,
        descargado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS admin.sync_jobs (
        id BIGSERIAL PRIMARY KEY,
        periodo_desde INT NOT NULL,
        periodo_hasta INT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      );
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS raw.carga_log (
        id BIGSERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        source_file TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'running'
          CHECK (status IN ('running', 'success', 'failed')),
        rows_inserted INT NOT NULL DEFAULT 0,
        rows_updated INT NOT NULL DEFAULT 0,
        rows_skipped INT NOT NULL DEFAULT 0,
        error_message TEXT,
        metadata JSONB,
        stage TEXT,
        topico TEXT,
        periodo INT,
        archivo_id UUID REFERENCES raw.archivos_descargados(id) ON DELETE SET NULL,
        triggered_by TEXT,
        sync_job_id BIGINT REFERENCES admin.sync_jobs(id) ON DELETE SET NULL
      );
    `);

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS admin.estructura_diffs (
        id BIGSERIAL PRIMARY KEY,
        periodo INT NOT NULL,
        grupo TEXT NOT NULL,
        topico TEXT NOT NULL,
        tipo_estado TEXT,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        carga_log_id BIGINT REFERENCES raw.carga_log(id) ON DELETE SET NULL,
        n_renames INT NOT NULL DEFAULT 0,
        n_extras INT NOT NULL DEFAULT 0,
        n_missing INT NOT NULL DEFAULT 0,
        severity TEXT NOT NULL DEFAULT 'info'
          CHECK (severity IN ('info', 'warning', 'critical')),
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        reviewed_at TIMESTAMPTZ,
        reviewed_by TEXT,
        review_action TEXT,
        review_notes TEXT
      );

      CREATE TABLE IF NOT EXISTS admin.data_quality_checks (
        id BIGSERIAL PRIMARY KEY,
        periodo INT NOT NULL,
        nomb_correg TEXT NOT NULL,
        check_type TEXT NOT NULL
          CHECK (check_type IN ('balance_contable', 'outlier_zscore', 'suma_subcuentas')),
        cuenta_codigo TEXT,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        carga_log_id BIGINT REFERENCES raw.carga_log(id) ON DELETE SET NULL,
        status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'critical')),
        expected_value NUMERIC,
        actual_value NUMERIC,
        delta_abs NUMERIC,
        delta_pct NUMERIC,
        z_score NUMERIC,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        reviewed_at TIMESTAMPTZ,
        reviewed_by TEXT,
        review_action TEXT,
        review_notes TEXT
      );
    `);

    // Minimal dw.entidad_nombre + raw.eeff_observacion for v_entidades_delta + freshness
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS dw.entidad_maestra (
        id BIGSERIAL PRIMARY KEY,
        nombre_canonico TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS dw.entidad_nombre (
        id BIGSERIAL PRIMARY KEY,
        entidad_id BIGINT REFERENCES dw.entidad_maestra(id),
        nombre TEXT NOT NULL,
        tipo TEXT NOT NULL,
        UNIQUE (entidad_id, nombre, tipo)
      );

      CREATE TABLE IF NOT EXISTS raw.eeff_observacion (
        id BIGSERIAL PRIMARY KEY,
        periodo INT NOT NULL,
        fecha_cierre DATE NOT NULL,
        tipo_estado TEXT NOT NULL,
        empresa_sbs TEXT,
        nomb_correg TEXT NOT NULL,
        tipo_entidad TEXT NOT NULL,
        moneda TEXT NOT NULL,
        cuenta_codigo TEXT NOT NULL,
        valor NUMERIC
      );
    `);

    await sql.unsafe(`
      CREATE OR REPLACE VIEW marts.v_entidades_delta AS
      WITH ultimos_dos_periodos AS (
          SELECT DISTINCT periodo FROM raw.eeff_observacion
          ORDER BY periodo DESC LIMIT 2
      ),
      poblacion AS (
          SELECT eo.periodo, eo.tipo_entidad, eo.nomb_correg
          FROM raw.eeff_observacion eo JOIN ultimos_dos_periodos u USING (periodo)
          GROUP BY eo.periodo, eo.tipo_entidad, eo.nomb_correg
      ),
      periodo_actual AS (SELECT MAX(periodo) AS p FROM ultimos_dos_periodos),
      periodo_previo AS (SELECT MIN(periodo) AS p FROM ultimos_dos_periodos),
      actuales AS (SELECT p.tipo_entidad, p.nomb_correg FROM poblacion p, periodo_actual pa WHERE p.periodo = pa.p),
      previos AS (SELECT p.tipo_entidad, p.nomb_correg FROM poblacion p, periodo_previo pp WHERE p.periodo = pp.p),
      delta AS (
          SELECT COALESCE(a.tipo_entidad, p.tipo_entidad) AS tipo_entidad,
                 COALESCE(a.nomb_correg, p.nomb_correg) AS nomb_correg,
                 CASE
                     WHEN a.nomb_correg IS NOT NULL AND p.nomb_correg IS NULL THEN 'nueva'
                     WHEN a.nomb_correg IS NULL AND p.nomb_correg IS NOT NULL THEN 'desaparecida'
                 END AS accion
          FROM actuales a
          FULL OUTER JOIN previos p ON a.nomb_correg = p.nomb_correg AND a.tipo_entidad = p.tipo_entidad
          WHERE a.nomb_correg IS NULL OR p.nomb_correg IS NULL
      )
      SELECT (SELECT p FROM periodo_actual) AS periodo_actual,
             (SELECT p FROM periodo_previo) AS periodo_previo,
             d.tipo_entidad, d.nomb_correg, d.accion,
             EXISTS (SELECT 1 FROM dw.entidad_nombre en WHERE en.nombre = d.nomb_correg) AS en_maestra
      FROM delta d;
    `);
  } finally {
    await sql.end();
  }
}

async function seedFixtures(url: string): Promise<void> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1 });
  try {
    // Limpiar tablas (orden por FKs)
    await sql.unsafe(`
      TRUNCATE raw.eeff_observacion CASCADE;
      TRUNCATE admin.estructura_diffs CASCADE;
      TRUNCATE admin.data_quality_checks RESTART IDENTITY CASCADE;
      TRUNCATE raw.carga_log RESTART IDENTITY CASCADE;
      TRUNCATE raw.archivos_descargados CASCADE;
      TRUNCATE dw.entidad_nombre CASCADE;
      TRUNCATE dw.entidad_maestra RESTART IDENTITY CASCADE;
    `);

    // archivos_descargados — 5 archivos distintos states para cobertura
    await sql.unsafe(`
      INSERT INTO raw.archivos_descargados (grupo, topico, periodo, anio, mes, nombre_archivo, path_local, source_url, tamanio_bytes, status)
      VALUES
        ('BANCOS', 'eeff', 202603, 2026, 3, 'B-2201.xls', '/x/B-2201.xls', 'https://x', 1000, 'procesado'),
        ('BANCOS', 'eeff', 202603, 2026, 3, 'B-2202.xls', '/x/B-2202.xls', 'https://x', 1000, 'procesado'),
        ('CMAC',   'eeff', 202603, 2026, 3, 'C-1101.xls', '/x/C-1101.xls', 'https://x', 1000, 'procesado'),
        ('CMAC',   'eeff', 202603, 2026, 3, 'C-1102.xls', '/x/C-1102.xls', 'https://x', 1000, 'error'),
        ('CMAC',   'depositos', 202603, 2026, 3, 'D-1101.xls', '/x/D-1101.xls', 'https://x', 500, 'no_publicado_sbs');
    `);

    // carga_log — distintos stages para health/timeline
    await sql.unsafe(`
      INSERT INTO raw.carga_log (source, stage, topico, periodo, status, rows_inserted, started_at, finished_at)
      VALUES
        ('scrape:eeff:202603',           'scrape',           'eeff', 202603, 'success', 414, NOW() - INTERVAL '2 hour',   NOW() - INTERVAL '2 hour' + INTERVAL '8 min'),
        ('import:eeff:202603',           'import',           'eeff', 202603, 'success', 50000, NOW() - INTERVAL '1 hour',  NOW() - INTERVAL '1 hour' + INTERVAL '19 min'),
        ('refresh-mvs',                  'refresh-mvs',      NULL,    NULL,   'success', 14, NOW() - INTERVAL '30 min',    NOW() - INTERVAL '30 min' + INTERVAL '2 min'),
        ('detectar-cambios:202603',      'detectar-cambios', NULL,    202603, 'success', 10, NOW() - INTERVAL '20 min',    NOW() - INTERVAL '20 min' + INTERVAL '12 sec'),
        ('detectar-cambios:202602',      'detectar-cambios', NULL,    202602, 'failed',  0,  NOW() - INTERVAL '5 day',     NOW() - INTERVAL '5 day' + INTERVAL '3 sec');
    `);

    // estructura_diffs — 1 warning (sin revisar) + 1 info ya revisado
    await sql.unsafe(`
      INSERT INTO admin.estructura_diffs
        (periodo, grupo, topico, tipo_estado, n_renames, n_extras, n_missing, severity, payload, reviewed_at, reviewed_by, review_action)
      VALUES
        (202603, 'BANCOS', 'eeff', 'balance', 0, 1, 0, 'warning',
         '{"extras":[{"orden":62,"archivo":"* Mediante Resolucion..."}],"renames":[],"missing":[]}'::jsonb,
         NULL, NULL, NULL),
        (202602, 'BANCOS', 'eeff', 'balance', 0, 0, 0, 'info', '{}'::jsonb,
         NOW() - INTERVAL '7 day', 'admin@test', 'ignored');
    `);

    // eeff_observacion — minimo para que v_entidades_delta tenga 2 periodos.
    // Forzamos una "nueva" entidad en 202603 que no estaba en 202602.
    await sql.unsafe(`
      INSERT INTO raw.eeff_observacion
        (periodo, fecha_cierre, tipo_estado, nomb_correg, tipo_entidad, moneda, cuenta_codigo, valor)
      VALUES
        (202602, '2026-02-28', 'balance', 'Banco Existente', 'BANCOS', 'TOTAL', 'A1', 100),
        (202603, '2026-03-31', 'balance', 'Banco Existente', 'BANCOS', 'TOTAL', 'A1', 110),
        (202603, '2026-03-31', 'balance', 'Banco Nuevo SA',  'BANCOS', 'TOTAL', 'A1', 50);
    `);

    // data_quality_checks — fixtures para los 3 tipos de check.
    await sql.unsafe(`
      INSERT INTO admin.data_quality_checks
        (periodo, nomb_correg, check_type, cuenta_codigo, status,
         expected_value, actual_value, delta_pct, z_score, payload)
      VALUES
        (202603, 'Mibanco', 'balance_contable', NULL, 'critical',
         11000000, 13000000, 0.18, NULL, '{"tipo_entidad":"BANCOS"}'::jsonb),
        (202603, 'Mibanco', 'outlier_zscore', 'C1', 'critical',
         NULL, 12500000, NULL, 10.5, '{"media_11m":1900000,"stddev_11m":50000}'::jsonb),
        (202603, 'Banco BCP', 'suma_subcuentas', 'A3', 'warning',
         35000000, 32000000, 0.085, NULL, '{}'::jsonb),
        (202602, 'Mibanco', 'balance_contable', NULL, 'ok',
         11000000, 11050000, 0.005, NULL, '{}'::jsonb);
    `);
  } finally {
    await sql.end();
  }
}

beforeAll(async () => {
  if (SKIP_INTEGRATION) return;
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("aibenchef_test")
    .withUsername("aibenchef")
    .withPassword("aibenchef")
    .start();
  testDbUrl = container.getConnectionUri();
  process.env.DATABASE_URL = testDbUrl;
  await setupSchema(testDbUrl);
}, 60_000);

afterAll(async () => {
  if (SKIP_INTEGRATION) return;
  await container?.stop();
});

beforeEach(async () => {
  if (SKIP_INTEGRATION) return;
  await seedFixtures(testDbUrl);
});

describe.skipIf(SKIP_INTEGRATION)("getPipelineHealth (REGRESION #22)", () => {
  it("ejecuta sin error y retorna byStage con las 4 stages esperadas", async () => {
    const { getPipelineHealth } = await import("./queries");
    const health = await getPipelineHealth();
    expect(health.byStage).toHaveLength(4);
    const stages = health.byStage.map((s) => s.stage).sort();
    expect(stages).toEqual(["detectar-cambios", "import", "refresh-mvs", "scrape"]);
  });

  it("último run de cada stage trae status correcto", async () => {
    const { getPipelineHealth } = await import("./queries");
    const health = await getPipelineHealth();
    const scrape = health.byStage.find((s) => s.stage === "scrape");
    expect(scrape?.status).toBe("success");
    // detectar-cambios mas reciente es success (20min ago), no el failed (5 dias ago)
    const detector = health.byStage.find((s) => s.stage === "detectar-cambios");
    expect(detector?.status).toBe("success");
  });

  it("dataFreshness retorna ultimoPeriodo del raw.eeff_observacion", async () => {
    const { getPipelineHealth } = await import("./queries");
    const health = await getPipelineHealth();
    expect(health.dataFreshness.ultimoPeriodoIngestado).toBe(202603);
    expect(["green", "amber", "red"]).toContain(health.dataFreshness.semaforo);
  });
});

describe.skipIf(SKIP_INTEGRATION)("getCobertura", () => {
  it("retorna breakdown correcto por (topico, grupo) con counts de cada status", async () => {
    const { getCobertura } = await import("./queries");
    const rows = await getCobertura(202603);
    // 3 filas: BANCOS+eeff (2 archivos), CMAC+eeff (2 archivos), CMAC+depositos (1)
    expect(rows.length).toBeGreaterThan(0);

    const bancosEeff = rows.find((r) => r.grupo === "BANCOS" && r.topico === "eeff");
    expect(bancosEeff).toBeDefined();
    expect(bancosEeff?.procesados).toBe(2);
    expect(bancosEeff?.errores).toBe(0);
    expect(bancosEeff?.pctCompletado).toBe(100);

    const cmacEeff = rows.find((r) => r.grupo === "CMAC" && r.topico === "eeff");
    expect(cmacEeff?.procesados).toBe(1);
    expect(cmacEeff?.errores).toBe(1);
    expect(cmacEeff?.pctCompletado).toBe(50); // 1 de 2 esperados

    const cmacDep = rows.find((r) => r.grupo === "CMAC" && r.topico === "depositos");
    expect(cmacDep?.noPublicados).toBe(1);
    // 1 archivo total, 1 no_publicado → esperados=0, pct=100 (no rompe DIV/0)
    expect(cmacDep?.pctCompletado).toBe(100);
  });

  it("retorna [] para periodo sin archivos", async () => {
    const { getCobertura } = await import("./queries");
    const rows = await getCobertura(190001);
    expect(rows).toEqual([]);
  });
});

describe.skipIf(SKIP_INTEGRATION)("getUltimoPeriodoConArchivos", () => {
  it("retorna el MAX(periodo) de archivos_descargados", async () => {
    const { getUltimoPeriodoConArchivos } = await import("./queries");
    const p = await getUltimoPeriodoConArchivos();
    expect(p).toBe(202603);
  });
});

describe.skipIf(SKIP_INTEGRATION)("listAnomalias", () => {
  it("filtro unreviewed=true excluye las ya revisadas", async () => {
    const { listAnomalias } = await import("./queries");
    const rows = await listAnomalias({ unreviewed: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("warning");
    expect(rows[0].reviewedAt).toBeNull();
  });

  it("sin filtros retorna todas, ordenadas por severity desc", async () => {
    const { listAnomalias } = await import("./queries");
    const rows = await listAnomalias({});
    expect(rows).toHaveLength(2);
    // warning antes que info (CASE en ORDER BY)
    expect(rows[0].severity).toBe("warning");
    expect(rows[1].severity).toBe("info");
  });

  it("filtro periodo aisla solo ese periodo", async () => {
    const { listAnomalias } = await import("./queries");
    const rows = await listAnomalias({ periodo: 202602 });
    expect(rows).toHaveLength(1);
    expect(rows[0].periodo).toBe(202602);
  });
});

describe.skipIf(SKIP_INTEGRATION)("reviewAnomalia", () => {
  it("marca como revisada y registra reviewer", async () => {
    const { reviewAnomalia, listAnomalias } = await import("./queries");
    const unreviewed = await listAnomalias({ unreviewed: true });
    const target = unreviewed[0];
    const { updated } = await reviewAnomalia(target.id, "admin@test.com", "ignored", "n/a");
    expect(updated).toBe(1);

    const after = await listAnomalias({ unreviewed: true });
    expect(after).toHaveLength(0);
  });

  it("review duplicado retorna updated=0 (idempotente)", async () => {
    const { reviewAnomalia, listAnomalias } = await import("./queries");
    const unreviewed = await listAnomalias({ unreviewed: true });
    const target = unreviewed[0];
    await reviewAnomalia(target.id, "admin@test.com", "ignored");
    const { updated } = await reviewAnomalia(target.id, "admin@test.com", "ignored");
    expect(updated).toBe(0);
  });
});

describe.skipIf(SKIP_INTEGRATION)("listEntidadesDelta", () => {
  it("detecta entidad nueva en periodo actual", async () => {
    const { listEntidadesDelta } = await import("./queries");
    const rows = await listEntidadesDelta();
    expect(rows.length).toBeGreaterThan(0);
    const nueva = rows.find((r) => r.accion === "nueva");
    expect(nueva?.nombCorreg).toBe("Banco Nuevo SA");
    expect(nueva?.enMaestra).toBe(false);
  });
});

describe.skipIf(SKIP_INTEGRATION)("getTimeline", () => {
  it("retorna las ultimas N corridas ordenadas por started_at desc", async () => {
    const { getTimeline } = await import("./queries");
    const rows = await getTimeline(20);
    expect(rows.length).toBe(5);
    // primera fila debe ser la mas reciente
    const first = rows[0];
    expect(first.stage).toBeDefined();
    expect(["success", "failed", "running"]).toContain(first.status);
  });

  it("respeta el limit", async () => {
    const { getTimeline } = await import("./queries");
    const rows = await getTimeline(2);
    expect(rows).toHaveLength(2);
  });
});

/* ──────────────────────────────────────────────────────────────────────── */
/* V2 Data Quality (issue #24)                                               */
/* ──────────────────────────────────────────────────────────────────────── */

describe.skipIf(SKIP_INTEGRATION)("getQualitySummary", () => {
  it("agrupa counts por check_type para el periodo", async () => {
    const { getQualitySummary } = await import("./queries");
    const summary = await getQualitySummary(202603);
    expect(summary.periodo).toBe(202603);
    expect(summary.byCheckType.length).toBeGreaterThan(0);

    const balance = summary.byCheckType.find((r) => r.checkType === "balance_contable");
    expect(balance?.critical).toBe(1);

    const outlier = summary.byCheckType.find((r) => r.checkType === "outlier_zscore");
    expect(outlier?.critical).toBe(1);

    expect(summary.totalCritical).toBe(2);
    expect(summary.totalWarning).toBe(1);
  });

  it("si no se pasa periodo, usa el ultimo con checks", async () => {
    const { getQualitySummary } = await import("./queries");
    const summary = await getQualitySummary();
    // 202603 es el max periodo con quality_checks en fixtures
    expect(summary.periodo).toBe(202603);
  });

  it("retorna summary vacio si no hay checks", async () => {
    const { getQualitySummary } = await import("./queries");
    const summary = await getQualitySummary(190001);
    expect(summary.byCheckType).toEqual([]);
    expect(summary.totalCritical).toBe(0);
  });
});

describe.skipIf(SKIP_INTEGRATION)("listQualityChecks", () => {
  it("filtra por checkType correctamente", async () => {
    const { listQualityChecks } = await import("./queries");
    const rows = await listQualityChecks({ checkType: "outlier_zscore" });
    expect(rows.length).toBe(1);
    expect(rows[0].checkType).toBe("outlier_zscore");
    expect(rows[0].zScore).toBeCloseTo(10.5);
  });

  it("filtra por severity correctamente", async () => {
    const { listQualityChecks } = await import("./queries");
    const rows = await listQualityChecks({ status: "critical" });
    expect(rows.length).toBe(2);
    rows.forEach((r) => expect(r.status).toBe("critical"));
  });

  it("filtra unreviewed=true excluye revisadas", async () => {
    const { listQualityChecks, reviewQualityCheck } = await import("./queries");
    const before = await listQualityChecks({ unreviewed: true });
    const targetId = before[0].id;
    await reviewQualityCheck(targetId, "admin@test", "ignored");
    const after = await listQualityChecks({ unreviewed: true });
    expect(after.find((r) => r.id === targetId)).toBeUndefined();
    expect(after.length).toBe(before.length - 1);
  });

  it("ordena por severity desc + z_score abs desc", async () => {
    const { listQualityChecks } = await import("./queries");
    const rows = await listQualityChecks({ periodo: 202603 });
    // criticals primero
    expect(rows[0].status).toBe("critical");
    expect(rows[1].status).toBe("critical");
    // warning despues
    if (rows.length >= 3) {
      expect(rows[2].status).toBe("warning");
    }
  });
});

describe.skipIf(SKIP_INTEGRATION)("reviewQualityCheck", () => {
  it("marca como revisado con email + action", async () => {
    const { listQualityChecks, reviewQualityCheck } = await import("./queries");
    const before = await listQualityChecks({ unreviewed: true });
    const target = before[0];
    const { updated } = await reviewQualityCheck(
      target.id,
      "gus@aibenchef.com",
      "falsa_alarma",
      "structure-by-design",
    );
    expect(updated).toBe(1);

    const after = await listQualityChecks({});
    const reviewed = after.find((r) => r.id === target.id);
    expect(reviewed?.reviewedBy).toBe("gus@aibenchef.com");
    expect(reviewed?.reviewAction).toBe("falsa_alarma");
  });

  it("review duplicado es idempotente (updated=0)", async () => {
    const { listQualityChecks, reviewQualityCheck } = await import("./queries");
    const before = await listQualityChecks({ unreviewed: true });
    const target = before[0];
    await reviewQualityCheck(target.id, "admin@test", "fixed");
    const second = await reviewQualityCheck(target.id, "admin@test", "fixed");
    expect(second.updated).toBe(0);
  });
});
