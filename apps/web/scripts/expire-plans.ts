/**
 * expire-plans — downgrade automatico de planes vencidos.
 *
 * Corre 2 funciones SQL en secuencia:
 *   1. auth.expire_trials()       → trials vencidos → free
 *   2. auth.expire_paid_plans()   → academic/pro/business vencidos → free
 *
 * Diseñado para correr diariamente (cron / GH Actions / manual).
 * Idempotente. Batch 500 por funcion. Fail-safe: si algo revienta,
 * exit 2 y ningun cambio parcial (cada funcion es atomica).
 *
 * Uso:
 *   DATABASE_URL=postgres://... npx tsx scripts/expire-plans.ts
 *
 * Flags:
 *   --dry-run    Solo cuenta cuantos expirarian, no ejecuta el UPDATE
 *   --only-trial Solo procesa trials (backwards-compat con expire-trials)
 *   --only-paid  Solo procesa planes pagados
 *   --help       Este mensaje
 */

import postgres from "postgres";

// ============================================================================
// CLI
// ============================================================================

type CliArgs = { dryRun: boolean; onlyTrial: boolean; onlyPaid: boolean };

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, onlyTrial: false, onlyPaid: false };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--only-trial") args.onlyTrial = true;
    else if (a === "--only-paid") args.onlyPaid = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`[expire-plans] ERROR: flag desconocido: ${a}`);
      process.exit(2);
    }
  }
  if (args.onlyTrial && args.onlyPaid) {
    console.error("[expire-plans] ERROR: --only-trial y --only-paid son mutuamente exclusivos");
    process.exit(2);
  }
  return args;
}

function printHelp(): void {
  console.log(`
expire-plans — downgrade automatico de planes vencidos (trial + pagados).

Uso:
  DATABASE_URL=postgres://... npx tsx scripts/expire-plans.ts [flags]

Flags:
  --dry-run     Solo cuenta cuantos expirarian
  --only-trial  Solo procesa trials (equiv al script expire-trials legacy)
  --only-paid   Solo procesa academic/pro/business
  --help        Este mensaje

Requiere DATABASE_URL en el env.
`);
}

// ============================================================================
// Main
// ============================================================================

const log = (msg: string): void => console.log(`[expire-plans] ${msg}`);

type TrialRow = { expired_count: number; sample_ids: string[] };
type PaidRow  = { expired_count: number; sample_ids: string[]; by_plan: Record<string, number> };

async function processTrials(sql: postgres.Sql, dryRun: boolean): Promise<void> {
  if (dryRun) {
    const rows = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
        FROM auth.users
       WHERE plan = 'trial'
         AND plan_expires_at IS NOT NULL
         AND plan_expires_at < now()
    `;
    const count = rows[0]?.count ?? 0;
    log(`trials --dry-run: ${count} vencidos que se downgradearian a free`);
    if (count === 0) return;
    const preview = await sql<{ email: string; days_expired: number }[]>`
      SELECT email,
             EXTRACT(DAY FROM (now() - plan_expires_at))::int AS days_expired
        FROM auth.users
       WHERE plan = 'trial'
         AND plan_expires_at < now()
       ORDER BY plan_expires_at ASC
       LIMIT 10
    `;
    for (const r of preview) {
      console.log(`  trial · ${r.email} — expiro hace ${r.days_expired} dia(s)`);
    }
    return;
  }

  const rows = await sql<TrialRow[]>`
    SELECT expired_count, sample_ids::text[] AS sample_ids
      FROM auth.expire_trials()
  `;
  const r = rows[0];
  const count = r?.expired_count ?? 0;
  if (count === 0) {
    log("trials: sin vencidos.");
    return;
  }
  log(`trials: ${count} expirados → downgrade a plan=free`);
  if (r?.sample_ids?.length) {
    log(`  sample ids: ${r.sample_ids.slice(0, 5).join(", ")}`);
  }
}

async function processPaid(sql: postgres.Sql, dryRun: boolean): Promise<void> {
  if (dryRun) {
    const rows = await sql<{ plan: string; count: number }[]>`
      SELECT plan, COUNT(*)::int AS count
        FROM auth.users
       WHERE plan IN ('academic', 'pro', 'business')
         AND plan_expires_at IS NOT NULL
         AND plan_expires_at < now()
       GROUP BY plan
    `;
    if (rows.length === 0) {
      log("paid --dry-run: sin planes pagados vencidos.");
      return;
    }
    const total = rows.reduce((s, r) => s + r.count, 0);
    log(`paid --dry-run: ${total} planes pagados vencidos que se downgradearian a free`);
    for (const r of rows) {
      console.log(`  ${r.plan}: ${r.count}`);
    }
    const preview = await sql<{ email: string; plan: string; days_expired: number }[]>`
      SELECT email, plan,
             EXTRACT(DAY FROM (now() - plan_expires_at))::int AS days_expired
        FROM auth.users
       WHERE plan IN ('academic', 'pro', 'business')
         AND plan_expires_at < now()
       ORDER BY plan_expires_at ASC
       LIMIT 10
    `;
    for (const r of preview) {
      console.log(`  ${r.plan} · ${r.email} — expiro hace ${r.days_expired} dia(s)`);
    }
    return;
  }

  const rows = await sql<PaidRow[]>`
    SELECT expired_count, sample_ids::text[] AS sample_ids, by_plan
      FROM auth.expire_paid_plans()
  `;
  const r = rows[0];
  const count = r?.expired_count ?? 0;
  if (count === 0) {
    log("paid: sin planes pagados vencidos.");
    return;
  }
  log(`paid: ${count} expirados → downgrade a plan=free`);
  if (r?.by_plan) {
    for (const [plan, n] of Object.entries(r.by_plan)) {
      log(`  ${plan}: ${n}`);
    }
  }
  if (r?.sample_ids?.length) {
    log(`  sample ids: ${r.sample_ids.slice(0, 5).join(", ")}`);
  }
  log("Sugerencia: revisar /admin/suscripciones para contactar renovacion.");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("[expire-plans] ERROR: DATABASE_URL no seteado");
    process.exit(2);
  }

  const sql = postgres(dbUrl, { max: 1, idle_timeout: 5, connect_timeout: 30 });
  try {
    if (!args.onlyPaid) {
      await processTrials(sql, args.dryRun);
    }
    if (!args.onlyTrial) {
      await processPaid(sql, args.dryRun);
    }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((e) => {
  console.error("[expire-plans] Exception:", e);
  process.exit(2);
});
