/**
 * regen-hero-mockup — regenera dashboard-mockup-data.json con el ultimo
 * cierre publicado.
 *
 * Se corre despues de cada ingesta mensual (ver
 * project_ingestion_manual.md). Es idempotente y fail-safe:
 *   - Si la DB no responde o falta data → exit code 2 y NO toca el JSON.
 *   - Si el JSON quedaria peor que el actual (menos entidades, valores
 *     null) → exit code 2 y NO toca el JSON.
 *   - Si todo OK → sobreescribe el JSON + imprime resumen.
 *
 * El componente dashboard-mockup.tsx importa el JSON directo — asi el
 * landing SIEMPRE tiene data valida aunque este script falle silencioso.
 *
 * Uso:
 *   DATABASE_URL=postgres://... npx tsx scripts/regen-hero-mockup.ts
 *
 * Flags:
 *   --periodo YYYYMM   Forzar periodo especifico (default: ultimo publicado)
 *   --dry-run          No escribir el JSON, solo imprimir preview
 *   --peer-group A,B   Override el peer group (default: top 5 bancos por cartera)
 *
 * Peer group deterministic:
 *   Default = top 5 bancos de Banca Multiple ordenados por cartera bruta
 *   descendente al periodo. Esto asegura reproducibilidad y evita que
 *   entidades random aparezcan en el hero.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// ============================================================================
// Config
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(
  __dirname,
  "..",
  "components",
  "marketing",
  "dashboard-mockup-data.json",
);

const MESES_ES: Record<number, string> = {
  1: "Ene",
  2: "Feb",
  3: "Mar",
  4: "Abr",
  5: "May",
  6: "Jun",
  7: "Jul",
  8: "Ago",
  9: "Sep",
  10: "Oct",
  11: "Nov",
  12: "Dic",
};

const PEER_GROUP_DEFAULT_SIZE = 5;

// ============================================================================
// Types (mirror del schema JSON)
// ============================================================================

type Fila = {
  label: string;
  seccion: "cartera" | "calidad" | "rentabilidad";
  valores: number[];
  format: "moneda_mm" | "pct" | "moneda_mm_utilidad";
  signo: 1 | -1;
};

type MockupData = {
  $schema?: string;
  generatedAt: string;
  generatedBy: string;
  periodo: number;
  periodoLabel: string;
  grupoSbs: string;
  propiaIdx: number;
  entidades: string[];
  filas: Fila[];
};

// ============================================================================
// CLI parsing
// ============================================================================

type CliArgs = {
  periodo?: number;
  dryRun: boolean;
  peerGroup?: string[];
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--periodo") {
      const val = argv[++i];
      if (!val || !/^\d{6}$/.test(val)) {
        die(`--periodo debe ser YYYYMM (ej: 202607). Recibido: ${val}`);
      }
      args.periodo = Number(val);
    } else if (a === "--dry-run") {
      args.dryRun = true;
    } else if (a === "--peer-group") {
      const val = argv[++i];
      if (!val) die("--peer-group requiere valor CSV");
      args.peerGroup = val.split(",").map((s) => s.trim()).filter(Boolean);
      if (args.peerGroup.length < 3 || args.peerGroup.length > 5) {
        die(
          `--peer-group debe tener 3-5 entidades. Recibido: ${args.peerGroup.length}`,
        );
      }
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      die(`Flag desconocido: ${a}. Usa --help.`);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
regen-hero-mockup — regenera el JSON del mockup del landing con el ultimo cierre.

Uso:
  npx tsx scripts/regen-hero-mockup.ts [flags]

Flags:
  --periodo YYYYMM       Forzar periodo (default: ultimo publicado en la DB)
  --peer-group A,B,C     Override peer group (default: top 5 bancos por cartera)
  --dry-run              Preview sin escribir el JSON
  --help                 Este mensaje

Requiere DATABASE_URL en el env.

Ejemplos:
  DATABASE_URL=postgres://... npx tsx scripts/regen-hero-mockup.ts
  npx tsx scripts/regen-hero-mockup.ts --periodo 202607 --dry-run
  npx tsx scripts/regen-hero-mockup.ts --peer-group "BCP,BBVA,Interbank,Scotiabank,Pichincha"
`);
}

// ============================================================================
// Helpers
// ============================================================================

const log = (msg: string): void => console.log(`[regen-hero] ${msg}`);
const warn = (msg: string): void => console.warn(`[regen-hero] WARN: ${msg}`);

function die(msg: string): never {
  console.error(`[regen-hero] ERROR: ${msg}`);
  process.exit(2);
}

function periodoLabel(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  const nombreMes = MESES_ES[mes] ?? String(mes);
  return `${nombreMes} ${anio}`;
}

function periodoMismoMesAnioPrev(periodo: number): number {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return (anio - 1) * 100 + mes;
}

function readCurrentJson(): MockupData | null {
  try {
    const raw = readFileSync(JSON_PATH, "utf-8");
    return JSON.parse(raw) as MockupData;
  } catch {
    return null;
  }
}

// ============================================================================
// Queries
// ============================================================================

async function getUltimoPeriodoPublicado(sql: postgres.Sql): Promise<number> {
  const rows = await sql<{ periodo: number }[]>`
    SELECT MAX(periodo)::int AS periodo
    FROM marts.v_eeff_balance_ancho
  `;
  const periodo = rows[0]?.periodo;
  if (!periodo) die("No hay periodos publicados en marts.v_eeff_balance_ancho");
  return periodo;
}

async function getTop5Bancos(
  sql: postgres.Sql,
  periodo: number,
): Promise<string[]> {
  const rows = await sql<{ nomb_correg: string }[]>`
    SELECT nomb_correg
    FROM marts.v_eeff_balance_ancho
    WHERE periodo = ${periodo}
      AND moneda = 'TOTAL'
      AND tipo_entidad = 'BANCOS'
    ORDER BY COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0) DESC
    LIMIT ${PEER_GROUP_DEFAULT_SIZE}
  `;
  return rows.map((r) => r.nomb_correg);
}

type KpiRaw = {
  nomb_correg: string;
  cartera: number | null;
  cartera_prev: number | null;
  atrasada: number | null;
  patrimonio: number | null;
  activos: number | null;
  utilidad_ttm: number | null;
  mora_global: number | null;
  cobertura_car: number | null;
};

async function getKpisRaw(
  sql: postgres.Sql,
  periodo: number,
  entidades: string[],
): Promise<Map<string, KpiRaw>> {
  const prev = periodoMismoMesAnioPrev(periodo);
  const rows = await sql<KpiRaw[]>`
    WITH bg_act AS (
      SELECT nomb_correg,
             COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0) AS cartera,
             COALESCE(cta_a4_3, 0) AS atrasada,
             cta_c AS patrimonio,
             cta_a AS activos
      FROM marts.v_eeff_balance_ancho
      WHERE periodo = ${periodo} AND moneda = 'TOTAL'
        AND nomb_correg = ANY(${entidades}::text[])
    ),
    bg_prev AS (
      SELECT nomb_correg,
             COALESCE(cta_a4_1, 0) + COALESCE(cta_a4_2, 0) + COALESCE(cta_a4_3, 0) AS cartera_prev
      FROM marts.v_eeff_balance_ancho
      WHERE periodo = ${prev} AND moneda = 'TOTAL'
        AND nomb_correg = ANY(${entidades}::text[])
    ),
    er_ttm AS (
      SELECT nomb_correg,
             SUM(cta_17) AS utilidad_ttm
      FROM marts.v_eeff_resultados_ancho
      WHERE periodo BETWEEN ${periodo - 11} AND ${periodo}
        AND moneda = 'TOTAL'
        AND nomb_correg = ANY(${entidades}::text[])
      GROUP BY nomb_correg
    ),
    mora AS (
      SELECT nomb_correg, pct_mora_global AS mora_global
      FROM marts.v_mora_global_por_entidad
      WHERE nomb_correg = ANY(${entidades}::text[])
    ),
    car AS (
      SELECT nomb_correg, pct_cobertura_car AS cobertura_car
      FROM marts.v_cobertura_car_por_entidad
      WHERE nomb_correg = ANY(${entidades}::text[])
    )
    SELECT
      a.nomb_correg,
      a.cartera,
      p.cartera_prev,
      a.atrasada,
      a.patrimonio,
      a.activos,
      e.utilidad_ttm,
      m.mora_global,
      c.cobertura_car
    FROM bg_act a
    LEFT JOIN bg_prev p USING (nomb_correg)
    LEFT JOIN er_ttm  e USING (nomb_correg)
    LEFT JOIN mora    m USING (nomb_correg)
    LEFT JOIN car     c USING (nomb_correg)
  `;
  const map = new Map<string, KpiRaw>();
  for (const r of rows) map.set(r.nomb_correg, r);
  return map;
}

// ============================================================================
// Transform: raw -> filas del mockup
// ============================================================================

function toMillones(n: number | null): number {
  if (n === null) return 0;
  return Math.round(n / 1_000_000);
}

function pct(n: number | null): number {
  if (n === null) return 0;
  // valores vienen como decimal (0.0273) o como pct (2.73)? Las MVs de
  // aibenchef exponen pct_mora_global como decimal (0-1). Multiplicar.
  // La cobertura CAR viene ya como pct (>100). Manejar caso por caso
  // usando magnitud como heuristica: si <= 2 → decimal, sino pct.
  return Number((n <= 2 ? n * 100 : n).toFixed(2));
}

function buildFilas(
  entidades: string[],
  raw: Map<string, KpiRaw>,
): Fila[] {
  const getMap = <T>(fn: (r: KpiRaw) => T): T[] =>
    entidades.map((e) => {
      const r = raw.get(e);
      if (!r) die(`Falta data para entidad "${e}" en el periodo`);
      return fn(r);
    });

  // Cartera Bruta MM S/
  const cartera = getMap((r) => toMillones(r.cartera));

  // Crec cartera YoY %
  const crecCartera = getMap((r) => {
    if (!r.cartera || !r.cartera_prev || r.cartera_prev === 0) return 0;
    return Number((((r.cartera - r.cartera_prev) / r.cartera_prev) * 100).toFixed(2));
  });

  // % Creditos Atrasados = atrasada / cartera
  const pctAtrasados = getMap((r) => {
    if (!r.cartera || r.cartera === 0) return 0;
    return Number(((r.atrasada ?? 0) / r.cartera * 100).toFixed(2));
  });

  // % Mora Global (sin VC)
  const moraGlobal = getMap((r) => pct(r.mora_global));

  // Cobertura CAR
  const coberturaCar = getMap((r) => pct(r.cobertura_car));

  // Utilidad Neta MM S/
  const utilidadNeta = getMap((r) => toMillones(r.utilidad_ttm));

  // ROE % = utilidad_ttm / patrimonio
  const roe = getMap((r) => {
    if (!r.patrimonio || r.patrimonio === 0) return 0;
    return Number((((r.utilidad_ttm ?? 0) / r.patrimonio) * 100).toFixed(2));
  });

  // ROA % = utilidad_ttm / activos
  const roa = getMap((r) => {
    if (!r.activos || r.activos === 0) return 0;
    return Number((((r.utilidad_ttm ?? 0) / r.activos) * 100).toFixed(2));
  });

  return [
    { label: "Cartera Bruta (MM S/)", seccion: "cartera", valores: cartera, format: "moneda_mm", signo: 1 },
    { label: "Crec. Cartera YoY", seccion: "cartera", valores: crecCartera, format: "pct", signo: 1 },
    { label: "% Créditos Atrasados", seccion: "calidad", valores: pctAtrasados, format: "pct", signo: -1 },
    { label: "% Mora Global (sin V/C)", seccion: "calidad", valores: moraGlobal, format: "pct", signo: -1 },
    { label: "Cobertura CAR (%)", seccion: "calidad", valores: coberturaCar, format: "pct", signo: 1 },
    { label: "Utilidad Neta (MM S/)", seccion: "rentabilidad", valores: utilidadNeta, format: "moneda_mm_utilidad", signo: 1 },
    { label: "% ROE", seccion: "rentabilidad", valores: roe, format: "pct", signo: 1 },
    { label: "% ROA", seccion: "rentabilidad", valores: roa, format: "pct", signo: 1 },
  ];
}

// ============================================================================
// Safety: validar que la data nueva no es peor que la actual
// ============================================================================

function validateNoRegression(next: MockupData, current: MockupData | null): void {
  if (!current) return;

  // 1. Mismo shape de filas (no perdimos KPIs)
  if (next.filas.length !== current.filas.length) {
    die(
      `Regression: nueva data tiene ${next.filas.length} filas, actual tiene ${current.filas.length}`,
    );
  }

  // 2. Ninguna fila tiene todo en zero (indicaria falla masiva de query)
  for (const f of next.filas) {
    const nonZero = f.valores.filter((v) => v !== 0).length;
    if (nonZero === 0) {
      die(`Regression: fila "${f.label}" tiene TODOS los valores en 0`);
    }
  }

  // 3. Mismo numero de entidades (o mas)
  if (next.entidades.length < current.entidades.length) {
    die(
      `Regression: nueva data tiene ${next.entidades.length} entidades, actual ${current.entidades.length}`,
    );
  }

  // 4. Periodo nuevo >= periodo actual
  if (next.periodo < current.periodo) {
    die(
      `Regression: periodo nuevo (${next.periodo}) es anterior al actual (${current.periodo}). Usa --periodo explicito si es intencional.`,
    );
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) die("DATABASE_URL no seteado en env");

  const sql = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 30 });
  try {
    // 1. Determinar periodo
    const periodo = args.periodo ?? (await getUltimoPeriodoPublicado(sql));
    log(`Periodo objetivo: ${periodo} (${periodoLabel(periodo)})`);

    // 2. Determinar peer group
    let peerGroup: string[];
    if (args.peerGroup) {
      peerGroup = args.peerGroup;
      log(`Peer group manual: ${peerGroup.join(", ")}`);
    } else {
      peerGroup = await getTop5Bancos(sql, periodo);
      log(`Peer group (top 5 bancos por cartera): ${peerGroup.join(", ")}`);
    }
    if (peerGroup.length === 0) {
      die(`No hay entidades para el periodo ${periodo}`);
    }

    // 3. Query KPIs
    const raw = await getKpisRaw(sql, periodo, peerGroup);
    if (raw.size === 0) {
      die(`Query devolvio 0 filas para ${peerGroup.join(", ")}`);
    }
    log(`KPIs raw obtenidos: ${raw.size}/${peerGroup.length} entidades`);

    // 4. Transformar
    const filas = buildFilas(peerGroup, raw);

    // 5. Armar JSON
    const next: MockupData = {
      $schema: "./dashboard-mockup-data.schema.json",
      generatedAt: new Date().toISOString(),
      generatedBy: `regen-hero-mockup script (${process.env.USER ?? "unknown"})`,
      periodo,
      periodoLabel: periodoLabel(periodo),
      grupoSbs: "Banca Múltiple",
      propiaIdx: 0,
      entidades: peerGroup,
      filas,
    };

    // 6. Validar contra actual
    const current = readCurrentJson();
    validateNoRegression(next, current);

    // 7. Escribir o dry-run
    if (args.dryRun) {
      log("--dry-run: NO se escribe el JSON. Preview:");
      console.log(JSON.stringify(next, null, 2));
      return;
    }

    const output = `${JSON.stringify(next, null, 2)}\n`;
    writeFileSync(JSON_PATH, output, "utf-8");
    log(`OK: ${JSON_PATH} actualizado (${filas.length} filas, ${peerGroup.length} entidades, cierre ${periodo})`);
    log("Proximo paso: git commit -am \"chore(landing): actualizar mockup cierre " + periodo + "\" && git push");
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(`[regen-hero] Exception:`, e);
  process.exit(2);
});
