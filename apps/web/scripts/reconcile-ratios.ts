/**
 * reconcile-ratios — QA interno: compara nuestros ratios vs los publicados
 * por SBS para detectar drift/bugs de metodologia.
 *
 * Ejecuta gov.reconcile_ratios(periodo) que popula gov.ratio_reconciliation
 * con derived_value + sbs_value + delta_bps por (periodo, entidad, indicador).
 *
 * NO afecta la UX: al usuario le mostramos siempre nuestro calculo. Esto
 * es puro back-office para vigilar la calidad.
 *
 * Uso:
 *   DATABASE_URL=postgres://... npx tsx scripts/reconcile-ratios.ts
 *   ...                                                    --periodo 202606
 *   ...                                                    --dry-run
 *
 * Flags:
 *   --periodo <YYYYMM>  Reconciliar un periodo especifico (default: ultimo
 *                       con data SBS publicada).
 *   --dry-run           Solo cuenta cuantas filas se reconciliarian.
 *   --help              Este mensaje.
 *
 * Salida: count + breakdown por indicador + top divergencias (si las hay).
 */

import postgres from "postgres";

type CliArgs = { dryRun: boolean; periodo: number | null };

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, periodo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--periodo") {
      const next = argv[++i];
      const n = next ? Number.parseInt(next, 10) : NaN;
      if (!Number.isFinite(n) || n < 200001 || n > 210012) {
        console.error(`[reconcile-ratios] ERROR: --periodo requiere YYYYMM valido`);
        process.exit(2);
      }
      args.periodo = n;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`[reconcile-ratios] ERROR: flag desconocido: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
reconcile-ratios — QA de nuestros ratios vs SBS oficial.

Uso:
  DATABASE_URL=postgres://... npx tsx scripts/reconcile-ratios.ts [flags]

Flags:
  --periodo YYYYMM   Reconciliar un periodo especifico
  --dry-run          Solo cuenta, no muta
  --help             Este mensaje

Requiere DATABASE_URL en el env.
`);
}

const log = (msg: string): void => console.log(`[reconcile-ratios] ${msg}`);

type ReconRow = {
  periodo_out: number;
  reconciled_count: number;
  divergence_count: number;
  by_indicador: Record<string, number>;
};

type Divergence = {
  nomb_correg: string;
  indicador: string;
  derived_value: number;
  sbs_value: number;
  delta_bps: number;
  severidad: string;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[reconcile-ratios] ERROR: DATABASE_URL no seteado");
    process.exit(2);
  }

  const sql = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 30 });
  try {
    if (args.dryRun) {
      // Detectar el periodo que se procesaria
      const rows = args.periodo
        ? await sql<{ periodo: number; count: number }[]>`
            SELECT ${args.periodo}::int AS periodo,
                   (SELECT COUNT(DISTINCT nomb_correg)::int
                      FROM marts.v_indicadores_ancho
                     WHERE periodo = ${args.periodo}
                       AND (roa_sbs IS NOT NULL OR roe_sbs IS NOT NULL
                            OR mora_atrasados_sobre_directos IS NOT NULL)
                   ) AS count
          `
        : await sql<{ periodo: number; count: number }[]>`
            WITH ult AS (
              SELECT MAX(periodo) AS periodo
                FROM marts.v_indicadores_ancho
               WHERE roa_sbs IS NOT NULL
            )
            SELECT ult.periodo,
                   (SELECT COUNT(DISTINCT nomb_correg)::int
                      FROM marts.v_indicadores_ancho v, ult
                     WHERE v.periodo = ult.periodo
                       AND (v.roa_sbs IS NOT NULL OR v.roe_sbs IS NOT NULL
                            OR v.mora_atrasados_sobre_directos IS NOT NULL)
                   ) AS count
              FROM ult
          `;
      const row = rows[0];
      if (!row?.periodo) {
        log("--dry-run: no hay data SBS publicada aun. Nada que hacer.");
        return;
      }
      log(`--dry-run: se reconciliaria periodo ${row.periodo} con ~${row.count} entidades x 3 indicadores`);
      return;
    }

    // Modo real: llamar la funcion SQL
    const args_sql = args.periodo ?? null;
    const rows = await sql<ReconRow[]>`
      SELECT periodo_out, reconciled_count, divergence_count, by_indicador
        FROM gov.reconcile_ratios(${args_sql}::int)
    `;
    const r = rows[0];
    if (!r?.periodo_out) {
      log("Sin data SBS publicada aun — nada que reconciliar.");
      return;
    }
    log(`OK periodo ${r.periodo_out}: ${r.reconciled_count} reconciliaciones, ${r.divergence_count} divergencias (>5 bps)`);
    if (r.by_indicador) {
      for (const [ind, cnt] of Object.entries(r.by_indicador)) {
        log(`  ${ind}: ${cnt} filas`);
      }
    }

    if (r.divergence_count > 0) {
      const top = await sql<Divergence[]>`
        SELECT nomb_correg, indicador,
               derived_value::float AS derived_value,
               sbs_value::float AS sbs_value,
               delta_bps, severidad
          FROM gov.v_ratio_divergences
         WHERE periodo = ${r.periodo_out}
         ORDER BY abs_delta_bps DESC
         LIMIT 10
      `;
      console.log("\nTop divergencias:");
      for (const d of top) {
        const sign = d.delta_bps >= 0 ? "+" : "";
        console.log(
          `  [${d.severidad}] ${d.indicador} · ${d.nomb_correg}: ` +
            `derived=${d.derived_value?.toFixed(2)}%, ` +
            `sbs=${d.sbs_value?.toFixed(2)}%, ` +
            `Δ=${sign}${d.delta_bps} bps`,
        );
      }
      log("Revisar en /dashboard/admin/calidad-datos");
    } else {
      log("Sin divergencias > 5 bps — todo alineado con SBS.");
    }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((e) => {
  console.error("[reconcile-ratios] Exception:", e);
  process.exit(2);
});
