/**
 * expire-trials — downgrade a plan=free todos los users con trial vencido.
 *
 * Corre diariamente (via cron, GH Actions, o manual). Idempotente:
 * ejecuciones repetidas en el mismo dia no hacen nada extra.
 *
 * Uso:
 *   DATABASE_URL=postgres://... npx tsx scripts/expire-trials.ts
 *
 * Flags:
 *   --dry-run    Solo cuenta cuantos expirarian, no ejecuta el UPDATE
 *   --help       Este mensaje
 *
 * Fail-safe:
 *   - Si DATABASE_URL falta → exit 2, sin efecto
 *   - Si la funcion SQL falla → exit 2, sin efecto (trials quedan como estaban)
 *   - Batch de 500 max por ejecucion (evita locks largos si aparece un
 *     surge de trials vencidos)
 *
 * Salida: log con count + primeros 5 ids (para auditoria/debug).
 */

import postgres from "postgres";

// ============================================================================
// CLI
// ============================================================================

type CliArgs = { dryRun: boolean };

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`[expire-trials] ERROR: flag desconocido: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
expire-trials — downgrade users con trial vencido a plan=free.

Uso:
  DATABASE_URL=postgres://... npx tsx scripts/expire-trials.ts [flags]

Flags:
  --dry-run    Solo cuenta cuantos expirarian
  --help       Este mensaje

Requiere DATABASE_URL en el env.
`);
}

// ============================================================================
// Main
// ============================================================================

const log = (msg: string): void => console.log(`[expire-trials] ${msg}`);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[expire-trials] ERROR: DATABASE_URL no seteado");
    process.exit(2);
  }

  const sql = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 30 });
  try {
    if (args.dryRun) {
      // DRY-RUN: solo cuenta, no muta
      const rows = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
          FROM auth.users
         WHERE plan = 'trial'
           AND plan_expires_at IS NOT NULL
           AND plan_expires_at < now()
      `;
      const count = rows[0]?.count ?? 0;
      log(`--dry-run: ${count} trials vencidos que se downgradearian a free`);
      if (count === 0) {
        log("Nada que hacer.");
        return;
      }
      const preview = await sql<{ id: string; email: string; days_expired: number }[]>`
        SELECT id::text,
               email,
               EXTRACT(DAY FROM (now() - plan_expires_at))::int AS days_expired
          FROM auth.users
         WHERE plan = 'trial'
           AND plan_expires_at < now()
         ORDER BY plan_expires_at ASC
         LIMIT 10
      `;
      console.log("\nPreview (primeros 10):");
      for (const r of preview) {
        console.log(`  ${r.email} — expiro hace ${r.days_expired} dia(s)`);
      }
      return;
    }

    // MODO REAL: ejecuta la funcion SQL (que hace UPDATE)
    const rows = await sql<{ expired_count: number; sample_ids: string[] }[]>`
      SELECT expired_count, sample_ids::text[] AS sample_ids
        FROM auth.expire_trials()
    `;
    const result = rows[0];
    const count = result?.expired_count ?? 0;
    const sampleIds = result?.sample_ids ?? [];

    if (count === 0) {
      log("Sin trials vencidos. Nada que hacer.");
      return;
    }

    log(`OK: ${count} trials expirados → downgrade a plan=free`);
    if (sampleIds.length > 0) {
      log(`Sample ids: ${sampleIds.slice(0, 5).join(", ")}`);
    }
    log("Sugerencia: si count >0 recurrente, considerar re-activar cron GH Actions.");
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((e) => {
  console.error("[expire-trials] Exception:", e);
  process.exit(2);
});
