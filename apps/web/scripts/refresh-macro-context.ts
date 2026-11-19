/**
 * refresh-macro-context — refresca el snapshot del contexto macro via
 * Claude + web_search y lo persiste en gov.macro_context.
 *
 * Uso:
 *   DATABASE_URL=postgres://... npx tsx scripts/refresh-macro-context.ts
 *
 * Tambien se puede disparar desde el admin UI (POST /admin/macro-context/refresh).
 * Costo tipico: $0.10-0.30 por refresh completo.
 */

/* eslint-disable no-console */

import { refreshMacroContext } from "@/lib/domains/governance/macro-context";

async function main() {
  const triggeredBy = process.argv[2] ?? "script:cli";
  console.log(`[refresh-macro] disparando refresh triggered_by=${triggeredBy}...`);
  const result = await refreshMacroContext(triggeredBy);
  console.log(
    JSON.stringify(
      {
        status: result.status,
        logId: result.logId,
        itemsCreated: result.itemsCreated,
        itemsExpired: result.itemsExpired,
        costUsd: result.costUsd,
        ...(result.error ? { error: result.error } : {}),
      },
      null,
      2,
    ),
  );
  if (result.status === "failed") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("refresh-macro fatal:", err);
  process.exitCode = 2;
});
