/**
 * Cliente Postgres + Drizzle (infrastructure layer).
 *
 * Lazy singleton: Next.js build no toca este modulo de manera que dispare
 * la creacion del cliente. En runtime, el primer acceso a `db.*` lo crea.
 *
 * withTenant() setea el GUC `app.tenant_id` para que las RLS policies
 * filtren automaticamente las queries dentro del callback.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __aibenchefPg: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __aibenchefDb: ReturnType<typeof drizzle> | undefined;
}

function getClient(): ReturnType<typeof postgres> {
  if (!globalThis.__aibenchefPg) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL no definida");
    }
    globalThis.__aibenchefPg = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return globalThis.__aibenchefPg;
}

function getDb(): ReturnType<typeof drizzle> {
  if (!globalThis.__aibenchefDb) {
    globalThis.__aibenchefDb = drizzle(getClient());
  }
  return globalThis.__aibenchefDb;
}

/**
 * Proxy lazy: durante Next.js build nadie accede a `db.*`, no se inicializa.
 * En runtime, el primer get() triggers getDb() y se crea el cliente real.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

/**
 * Ejecuta `fn` con `app.tenant_id` seteado en la sesion Postgres.
 * Las RLS policies en tablas tenant-scoped filtran automatico.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await getClient()`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  return fn();
}

export * as schema from "./schema";
