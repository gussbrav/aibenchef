/**
 * Helper para establecer el contexto del request en Postgres.
 *
 * Cada request HTTP debe llamar `applyRequestContext(ctx)` al inicio.
 * Eso setea los GUCs `app.user_id`, `app.tenant_id`, `app.is_admin`
 * a nivel de la TRANSACCION actual via `SET LOCAL`.
 *
 * Las policies RLS de schemas multi-tenant (gov.*, futuras tablas de
 * clientes) usan esos settings para filtrar.
 *
 * IMPORTANTE: `SET LOCAL` solo aplica dentro de una transaccion. Si una
 * query corre fuera de transaccion, el contexto se pierde. Por eso este
 * helper devuelve un wrapper `withRequestContext()` que abre una
 * transaccion explicita.
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";

import type { RequestContext } from "./types";

/**
 * Ejecuta una funcion con el RequestContext aplicado a la transaccion.
 *
 * Patron tipico:
 *   await withRequestContext({userId, tenantId, isAdmin}, async (tx) => {
 *     return tx.execute(sql`SELECT * FROM gov.audit_log WHERE ...`);
 *   });
 *
 * Garantia: si la funcion throwa, la transaccion hace rollback. Los
 * GUCs nunca filtran a transacciones siguientes (SET LOCAL).
 */
export async function withRequestContext<T>(
  ctx: RequestContext,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.userId}, true)`);
    await tx.execute(
      sql`SELECT set_config('app.tenant_id', ${ctx.tenantId ?? ""}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.is_admin', ${ctx.isAdmin ? "true" : "false"}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Variante para cuando solo necesitas EJECUTAR queries con el contexto
 * pero no te interesa controlar la transaccion. Wrapper conveniente.
 *
 * NOTA DE SEGURIDAD: NO usar para SELECTs que devuelven al cliente sin
 * verificar tenant — la responsabilidad de filtrar la sigue teniendo el
 * caller. Este helper solo garantiza que RLS este efectivo.
 */
export async function executeWithContext<T>(
  ctx: RequestContext,
  query: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return withRequestContext(ctx, query);
}
