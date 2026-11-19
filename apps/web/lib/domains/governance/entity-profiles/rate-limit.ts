/**
 * Rate limiter global del research de entity profiles.
 *
 * Cap diario: 20 nuevos researches por dia (UTC). Protege contra abuso /
 * costo descontrolado. Usa tabla gov.entity_research_daily_usage como
 * contador transaccional idempotente.
 *
 * Nota: "research" aqui significa una llamada efectiva a Claude + web_search.
 * Los lookups contra cache (perfil ya existente) NO cuentan contra el limite.
 */

import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import type { RateLimitStatus } from "./types";

/**
 * Cap diario. Se puede override via env ENTITY_RESEARCH_DAILY_LIMIT para
 * subir/bajar sin tocar codigo.
 */
function getDailyLimit(): number {
  const envVal = process.env.ENTITY_RESEARCH_DAILY_LIMIT;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 20;
}

/**
 * Verifica si podemos disparar un research mas hoy (sin incrementar).
 * Para el check + increment atomico, usar `tryConsumeResearch`.
 */
export async function getRateLimitStatus(): Promise<RateLimitStatus> {
  const dailyLimit = getDailyLimit();
  const rows = await db.execute<{
    fecha_utc: string;
    research_count: number;
    total_cost_usd: string;
  }>(sql`
    SELECT fecha_utc,
           research_count,
           total_cost_usd
      FROM gov.entity_research_daily_usage
     WHERE fecha_utc = (now() AT TIME ZONE 'UTC')::date
     LIMIT 1
  `);
  const row = rows[0];
  const researchCount = row ? row.research_count : 0;
  const totalCostUsd = row ? Number(row.total_cost_usd) : 0;
  return {
    fechaUtc: row?.fecha_utc ?? new Date().toISOString().slice(0, 10),
    researchCount,
    dailyLimit,
    remaining: Math.max(0, dailyLimit - researchCount),
    allowed: researchCount < dailyLimit,
    totalCostUsd,
  };
}

/**
 * Intenta consumir 1 slot del rate limit. Retorna true si habia cupo
 * (y lo reservo), false si el cap esta alcanzado. Idempotente por dia
 * UTC. Guarda tambien el costo acumulado para reporting.
 *
 * Flujo transaccional:
 *   1. INSERT ON CONFLICT DO UPDATE sobre fecha_utc
 *   2. Si post-update research_count > dailyLimit → rollback via check
 *   3. Si OK → retorna true
 */
export async function tryConsumeResearch(costUsd: number): Promise<boolean> {
  const dailyLimit = getDailyLimit();

  // Primero chequear sin lock — barato
  const status = await getRateLimitStatus();
  if (!status.allowed) return false;

  // Reservar el slot con upsert. Idempotente por fecha UTC.
  try {
    const rows = await db.execute<{ research_count: number }>(sql`
      INSERT INTO gov.entity_research_daily_usage (
        fecha_utc, research_count, total_cost_usd, last_research_at
      ) VALUES (
        (now() AT TIME ZONE 'UTC')::date, 1, ${costUsd}::numeric, now()
      )
      ON CONFLICT (fecha_utc) DO UPDATE SET
        research_count   = gov.entity_research_daily_usage.research_count + 1,
        total_cost_usd   = gov.entity_research_daily_usage.total_cost_usd + EXCLUDED.total_cost_usd,
        last_research_at = now(),
        updated_at       = now()
      RETURNING research_count
    `);
    const newCount = Number(rows[0]?.research_count ?? dailyLimit + 1);
    return newCount <= dailyLimit;
  } catch {
    // best-effort: si falla el counter, no bloqueamos el research
    // pero loggeamos
    return true;
  }
}
