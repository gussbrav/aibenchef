import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL no definida");
}

// Pool de conexiones reutilizable entre invocaciones de Next.js
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false, // mejor para pgbouncer/transaction pooling
});

export const db = drizzle(client);

// Helper para setear app.tenant_id en transacciones (RLS)
export async function withTenant<T>(
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  return fn();
}
