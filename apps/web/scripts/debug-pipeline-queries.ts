/**
 * Debug script — corre cada query del domain pipeline contra DB real
 * para aislar cual falla en SSR. Usar:
 *
 *   cd apps/web && DATABASE_URL=postgres://... npx tsx scripts/debug-pipeline-queries.ts
 */
/* eslint-disable no-console */

import {
  getCobertura,
  getPipelineHealth,
  getTimeline,
  getUltimoPeriodoConArchivos,
  listAnomalias,
  listEntidadesDelta,
} from "../lib/domains/pipeline";

async function runQuery<T>(name: string, fn: () => Promise<T>): Promise<void> {
  process.stdout.write(`${name.padEnd(36, ".")} `);
  try {
    const result = await fn();
    const summary =
      Array.isArray(result)
        ? `OK (${result.length} rows)`
        : `OK (${typeof result === "object" ? JSON.stringify(result).slice(0, 80) : String(result)})`;
    console.log(summary);
  } catch (e) {
    console.log("FAIL");
    console.error("  ", e);
  }
}

async function main(): Promise<void> {
  console.log("# Debug pipeline queries contra", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@"));
  console.log("");

  await runQuery("getPipelineHealth()", () => getPipelineHealth());
  const periodo = await (async () => {
    try {
      const p = await getUltimoPeriodoConArchivos();
      console.log(`getUltimoPeriodoConArchivos()............ OK (${p})`);
      return p;
    } catch (e) {
      console.log("getUltimoPeriodoConArchivos()............ FAIL");
      console.error("  ", e);
      return null;
    }
  })();
  if (periodo != null) {
    await runQuery(`getCobertura(${periodo})`, () => getCobertura(periodo));
  }
  await runQuery("listAnomalias({unreviewed:true,limit:50})", () =>
    listAnomalias({ unreviewed: true, limit: 50 }),
  );
  await runQuery("listEntidadesDelta()", () => listEntidadesDelta());
  await runQuery("getTimeline(20)", () => getTimeline(20));

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
