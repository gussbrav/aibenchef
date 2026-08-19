/**
 * reverify-sbs — guardarail contra "no_publicado_sbs" stale.
 *
 * BUG que previene (2026-08-19): financieras/indicadores/202606 seguia
 * marcado como 'no_publicado_sbs' varios dias despues de que SBS ya
 * habia publicado. Con el cron auto desactivado, la unica forma de
 * detectarlo era esperar a que un admin abriera el informe y notara
 * el badge "PUBLICACION PARCIAL".
 *
 * Este script cierra el gap: corre 1x al dia (o cuando se ejecuta la
 * ingesta manual) y encola sync_jobs con force_redownload=true para
 * cada periodo que tenga archivos en la vista admin.v_no_publicados_reverificables
 * (V178: threshold laxo publish_lag+3d + rate limit 3d entre re-checks).
 *
 * NO reprocesa archivos ya procesados. Cero riesgo de romper data existente.
 * Solo intenta re-descargar los que SBS podria haber publicado despues de
 * la ultima verificacion.
 *
 * Uso:
 *   DATABASE_URL=postgres://... npx tsx scripts/reverify-sbs.ts
 *   ...                                                --dry-run
 *   ...                                                --max-jobs 5
 *
 * Flags:
 *   --dry-run       Solo muestra que periodos se re-verificarian
 *   --max-jobs N    Limite de sync_jobs a encolar por corrida (default 20).
 *                   Defensivo para no saturar el worker.
 *   --help          Este mensaje.
 */

import postgres from "postgres";

type CliArgs = { dryRun: boolean; maxJobs: number };

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, maxJobs: 20 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--max-jobs") {
      const next = argv[++i];
      const n = next ? Number.parseInt(next, 10) : NaN;
      if (!Number.isFinite(n) || n < 1 || n > 100) {
        console.error("[reverify-sbs] ERROR: --max-jobs 1..100");
        process.exit(2);
      }
      args.maxJobs = n;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`[reverify-sbs] ERROR: flag desconocido: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
reverify-sbs — auto re-check de archivos 'no_publicado_sbs' vencidos.

Uso:
  DATABASE_URL=postgres://... npx tsx scripts/reverify-sbs.ts [flags]

Flags:
  --dry-run       Solo cuenta que periodos se re-verificarian
  --max-jobs N    Limite de sync_jobs a encolar (1..100, default 20)
  --help          Este mensaje

Requiere DATABASE_URL en el env.
`);
}

const log = (msg: string): void => console.log(`[reverify-sbs] ${msg}`);

type Reverificable = {
  periodo: number;
  grupo: string;
  topico: string;
  dias_desde_esperado: number;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[reverify-sbs] ERROR: DATABASE_URL no seteado");
    process.exit(2);
  }

  const sql = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 30 });
  try {
    const rows = await sql<Reverificable[]>`
      SELECT periodo, grupo, topico, dias_desde_esperado
        FROM admin.v_no_publicados_reverificables
       ORDER BY periodo DESC, grupo, topico
    `;
    if (rows.length === 0) {
      log("Sin archivos re-verificables (todos dentro del rate limit o ya procesados).");
      return;
    }

    // Deduplicar por periodo — 1 sync_job por periodo cubre todos los
    // (grupo, topico) faltantes de ese periodo.
    const periodosSet = new Map<number, Reverificable[]>();
    for (const r of rows) {
      const arr = periodosSet.get(r.periodo) ?? [];
      arr.push(r);
      periodosSet.set(r.periodo, arr);
    }
    const periodos = Array.from(periodosSet.keys()).sort((a, b) => b - a);

    log(`Encontrados ${rows.length} archivos re-verificables en ${periodos.length} periodo(s):`);
    for (const p of periodos.slice(0, 10)) {
      const items = periodosSet.get(p)!;
      const topicos = new Set(items.map((i) => i.topico));
      const grupos = new Set(items.map((i) => i.grupo));
      const maxDias = Math.max(...items.map((i) => i.dias_desde_esperado));
      console.log(
        `  periodo ${p}: ${items.length} archivos (${Array.from(topicos).join(",")}) x ` +
          `(${Array.from(grupos).join(",")}) — max ${maxDias}d desde esperado`,
      );
    }
    if (periodos.length > 10) {
      console.log(`  … y ${periodos.length - 10} periodos mas`);
    }

    if (args.dryRun) {
      log("--dry-run: no se encola nada.");
      return;
    }

    // Encolar. Cap por --max-jobs. Skip los periodos que ya tengan sync_job
    // pending/running (idempotencia).
    let encolados = 0;
    let skipeados = 0;
    const jobIds: number[] = [];
    for (const periodo of periodos.slice(0, args.maxJobs)) {
      const inserted = await sql<{ id: number }[]>`
        INSERT INTO admin.sync_jobs (
          periodo_desde, periodo_hasta, force_redownload,
          triggered_by, triggered_by_email
        )
        SELECT ${periodo}, ${periodo}, true,
               'reverify-sbs-cron', 'system@aibenchef.internal'
         WHERE NOT EXISTS (
           SELECT 1 FROM admin.sync_jobs
            WHERE status IN ('pending', 'running')
              AND periodo_desde = ${periodo}
              AND periodo_hasta = ${periodo}
         )
        RETURNING id
      `;
      const row = inserted[0];
      if (row?.id != null) {
        encolados++;
        jobIds.push(Number(row.id));
      } else {
        skipeados++;
      }
    }

    log(`OK: ${encolados} sync_jobs encolados, ${skipeados} skipeados (ya en cola).`);
    if (jobIds.length > 0) {
      log(`Job IDs: ${jobIds.slice(0, 10).join(", ")}${jobIds.length > 10 ? "…" : ""}`);
    }
    if (periodos.length > args.maxJobs) {
      log(`Nota: ${periodos.length - args.maxJobs} periodos quedaron fuera del batch (--max-jobs=${args.maxJobs}).`);
    }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((e) => {
  console.error("[reverify-sbs] Exception:", e);
  process.exit(2);
});
