/**
 * Repository de MacroContextItem — CRUD sobre gov.macro_context.
 */

import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import type {
  MacroCategoria,
  MacroContextItem,
  MacroSeveridad,
} from "./types";

type DbRow = {
  id: string;
  snapshot_at: string;
  categoria: string;
  titulo: string;
  resumen: string;
  impacto: string | null;
  severidad: string;
  vigente_hasta: string | null;
  fuentes: string[] | null;
  research_model: string | null;
  research_cost_usd: string;
  verified_by_human: boolean;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToItem(r: DbRow): MacroContextItem {
  return {
    id: r.id,
    snapshotAt: r.snapshot_at,
    categoria: r.categoria as MacroCategoria,
    titulo: r.titulo,
    resumen: r.resumen,
    impacto: r.impacto,
    severidad: r.severidad as MacroSeveridad,
    vigenteHasta: r.vigente_hasta,
    fuentes: r.fuentes ?? [],
    researchModel: r.research_model,
    researchCostUsd: Number(r.research_cost_usd ?? 0),
    verifiedByHuman: r.verified_by_human,
    verifiedBy: r.verified_by,
    verifiedAt: r.verified_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Lee los items vigentes (vigente_hasta >= hoy o NULL) ordenados por
 * severidad descendente y por categoria. Es lo que consume el enrichment
 * de insights.
 */
export async function getVigentes(limit = 20): Promise<MacroContextItem[]> {
  const rows = await db.execute<DbRow>(sql`
    SELECT * FROM gov.macro_context
     WHERE vigente_hasta IS NULL OR vigente_hasta >= CURRENT_DATE
     ORDER BY
       CASE severidad
         WHEN 'alta' THEN 1
         WHEN 'media' THEN 2
         WHEN 'baja' THEN 3
         WHEN 'informativo' THEN 4
         ELSE 5
       END,
       categoria,
       updated_at DESC
     LIMIT ${limit}::int
  `);
  return rows.map((r) => rowToItem(r as unknown as DbRow));
}

export async function listAll(params: {
  filter?: "all" | "vigentes" | "expirados" | "pending";
  limit?: number;
  offset?: number;
}): Promise<{ rows: MacroContextItem[]; total: number }> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const filter = params.filter ?? "all";

  const whereClause =
    filter === "vigentes"
      ? sql`WHERE vigente_hasta IS NULL OR vigente_hasta >= CURRENT_DATE`
      : filter === "expirados"
        ? sql`WHERE vigente_hasta IS NOT NULL AND vigente_hasta < CURRENT_DATE`
        : filter === "pending"
          ? sql`WHERE verified_by_human = false`
          : sql``;

  const totalRows = await db.execute<{ total: string }>(sql`
    SELECT COUNT(*)::text AS total FROM gov.macro_context ${whereClause}
  `);
  const total = Number(totalRows[0]?.total ?? 0);

  const rows = await db.execute<DbRow>(sql`
    SELECT * FROM gov.macro_context
    ${whereClause}
    ORDER BY updated_at DESC
    LIMIT ${limit}::int OFFSET ${offset}::int
  `);
  return {
    rows: rows.map((r) => rowToItem(r as unknown as DbRow)),
    total,
  };
}

export async function insertResearchItem(params: {
  categoria: MacroCategoria;
  titulo: string;
  resumen: string;
  impacto: string | null;
  severidad: MacroSeveridad;
  vigenteHasta: string | null;
  fuentes: string[];
  researchModel: string;
  researchCostUsd: number;
}): Promise<string> {
  const fuentesSql =
    params.fuentes.length === 0
      ? sql`ARRAY[]::text[]`
      : sql`ARRAY[${sql.join(params.fuentes.map((f) => sql`${f}`), sql`, `)}]::text[]`;

  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO gov.macro_context (
      categoria, titulo, resumen, impacto, severidad, vigente_hasta,
      fuentes, research_model, research_cost_usd
    ) VALUES (
      ${params.categoria}::text,
      ${params.titulo}::text,
      ${params.resumen}::text,
      ${params.impacto}::text,
      ${params.severidad}::text,
      ${params.vigenteHasta}::date,
      ${fuentesSql},
      ${params.researchModel}::text,
      ${params.researchCostUsd}::numeric
    )
    RETURNING id
  `);
  return rows[0]?.id as string;
}

export async function updateItem(params: {
  id: string;
  titulo?: string;
  resumen?: string;
  impacto?: string | null;
  severidad?: MacroSeveridad;
  vigenteHasta?: string | null;
}): Promise<void> {
  await db.execute(sql`
    UPDATE gov.macro_context
       SET titulo        = COALESCE(${params.titulo ?? null}::text, titulo),
           resumen       = COALESCE(${params.resumen ?? null}::text, resumen),
           impacto       = ${params.impacto === undefined ? sql`impacto` : sql`${params.impacto}::text`},
           severidad     = COALESCE(${params.severidad ?? null}::text, severidad),
           vigente_hasta = ${params.vigenteHasta === undefined ? sql`vigente_hasta` : sql`${params.vigenteHasta}::date`}
     WHERE id = ${params.id}::uuid
  `);
}

export async function verifyItem(params: {
  id: string;
  verifiedBy: string;
}): Promise<void> {
  await db.execute(sql`
    UPDATE gov.macro_context
       SET verified_by_human = true,
           verified_by       = ${params.verifiedBy},
           verified_at       = now()
     WHERE id = ${params.id}::uuid
  `);
}

export async function deleteItem(id: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM gov.macro_context WHERE id = ${id}::uuid
  `);
}

/**
 * Marca como expirados (vigente_hasta = ayer) los items cuya vigencia
 * explicita o estimada ya paso. Retorna cuantos marco.
 */
export async function expireStaleItems(): Promise<number> {
  const rows = await db.execute<{ affected: string }>(sql`
    WITH upd AS (
      UPDATE gov.macro_context
         SET vigente_hasta = CURRENT_DATE - INTERVAL '1 day'
       WHERE vigente_hasta IS NOT NULL
         AND vigente_hasta < CURRENT_DATE
         AND updated_at < now() - INTERVAL '7 days'
      RETURNING 1
    )
    SELECT COUNT(*)::text AS affected FROM upd
  `);
  return Number(rows[0]?.affected ?? 0);
}

export async function startRefreshLog(triggeredBy: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO gov.macro_context_refresh_log (status, triggered_by)
    VALUES ('running', ${triggeredBy})
    RETURNING id
  `);
  return rows[0]?.id as string;
}

export async function finishRefreshLog(params: {
  id: string;
  itemsCreated: number;
  itemsUpdated: number;
  itemsExpired: number;
  costUsd: number;
  status: "ok" | "failed";
  error?: string;
}): Promise<void> {
  await db.execute(sql`
    UPDATE gov.macro_context_refresh_log
       SET finished_at   = now(),
           items_created = ${params.itemsCreated}::int,
           items_updated = ${params.itemsUpdated}::int,
           items_expired = ${params.itemsExpired}::int,
           cost_usd      = ${params.costUsd}::numeric,
           status        = ${params.status}::text,
           error         = ${params.error ?? null}::text
     WHERE id = ${params.id}::uuid
  `);
}

export async function getLastRefresh(): Promise<{
  startedAt: string;
  finishedAt: string | null;
  status: string;
  itemsCreated: number;
  itemsUpdated: number;
  costUsd: number;
  triggeredBy: string | null;
} | null> {
  const rows = await db.execute<{
    started_at: string;
    finished_at: string | null;
    status: string;
    items_created: number;
    items_updated: number;
    cost_usd: string;
    triggered_by: string | null;
  }>(sql`
    SELECT started_at, finished_at, status, items_created, items_updated,
           cost_usd, triggered_by
      FROM gov.macro_context_refresh_log
     ORDER BY started_at DESC
     LIMIT 1
  `);
  const r = rows[0];
  if (!r) return null;
  return {
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    itemsCreated: r.items_created,
    itemsUpdated: r.items_updated,
    costUsd: Number(r.cost_usd),
    triggeredBy: r.triggered_by,
  };
}
