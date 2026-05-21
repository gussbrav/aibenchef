import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Lazy singleton client + db. Evita ejecutar postgres() en module-load
// para que Next.js build no falle al "collect page data" sin DATABASE_URL.

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

// Proxy que difiere la creacion del client hasta el primer acceso real.
// Durante Next.js build nadie accede a `db.*`, asi que no se inicializa.
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

// Helper para setear app.tenant_id en transacciones (RLS multi-tenant).
export async function withTenant<T>(
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await getClient()`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  return fn();
}
