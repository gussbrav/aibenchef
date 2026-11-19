/**
 * Repository de EntityProfile — lectura/escritura en gov.entity_profiles.
 *
 * Pattern: funciones puras con DB client inyectado, sin estado.
 * Alineado con docs/design/data-governance-v1.md (puertos como interfaces).
 */

import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import type { EntityProfile, ModeloNegocio } from "./types";

type DbRow = {
  nomb_correg: string;
  tipo_entidad: string | null;
  ubicacion: string | null;
  inicio_operaciones: string | null;
  ruc_sunat: string | null;
  publico_objetivo: string | null;
  modelo_negocio: string | null;
  segmento_cartera_hipotesis: string | null;
  productos_principales: string | null;
  notas: string | null;
  fuentes: string[] | null;
  research_at: string | null;
  research_model: string | null;
  research_cost_usd: string;
  research_count: number;
  verified_by_human: boolean;
  verified_by: string | null;
  verified_at: string | null;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToProfile(r: DbRow): EntityProfile {
  return {
    nombCorreg: r.nomb_correg,
    tipoEntidad: r.tipo_entidad,
    ubicacion: r.ubicacion,
    inicioOperaciones: r.inicio_operaciones,
    rucSunat: r.ruc_sunat,
    publicoObjetivo: r.publico_objetivo,
    modeloNegocio: (r.modelo_negocio as ModeloNegocio | null) ?? null,
    segmentoCarteraHipotesis: r.segmento_cartera_hipotesis,
    productosPrincipales: r.productos_principales,
    notas: r.notas,
    fuentes: r.fuentes ?? [],
    researchAt: r.research_at,
    researchModel: r.research_model,
    researchCostUsd: Number(r.research_cost_usd ?? 0),
    researchCount: r.research_count,
    verifiedByHuman: r.verified_by_human,
    verifiedBy: r.verified_by,
    verifiedAt: r.verified_at,
    useCount: r.use_count,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Lee un perfil por nomb_correg. Retorna null si no existe.
 */
export async function getEntityProfile(
  nombCorreg: string,
): Promise<EntityProfile | null> {
  const rows = await db.execute<DbRow>(sql`
    SELECT * FROM gov.entity_profiles WHERE nomb_correg = ${nombCorreg} LIMIT 1
  `);
  return rows[0] ? rowToProfile(rows[0] as unknown as DbRow) : null;
}

/**
 * Lee varios perfiles en una sola query.
 */
export async function getEntityProfilesBulk(
  nombCorregs: string[],
): Promise<Map<string, EntityProfile>> {
  if (nombCorregs.length === 0) return new Map();
  // Drizzle serializa string[] como record; construimos ARRAY[...]::text[]
  // explicito via sql.join.
  const arrSql = sql`ARRAY[${sql.join(nombCorregs.map((v) => sql`${v}`), sql`, `)}]::text[]`;
  const rows = await db.execute<DbRow>(sql`
    SELECT * FROM gov.entity_profiles
     WHERE nomb_correg = ANY(${arrSql})
  `);
  const map = new Map<string, EntityProfile>();
  for (const r of rows) {
    const profile = rowToProfile(r as unknown as DbRow);
    map.set(profile.nombCorreg, profile);
  }
  return map;
}

/**
 * Upsert tras un research exitoso. Mezcla con lo que ya habia (preserva
 * verified_by_human si estaba true, acumula research_cost_usd y _count).
 */
export async function upsertEntityProfileFromResearch(params: {
  nombCorreg: string;
  tipoEntidad: string | null;
  ubicacion: string | null;
  inicioOperaciones: string | null;
  rucSunat: string | null;
  publicoObjetivo: string | null;
  modeloNegocio: ModeloNegocio | null;
  segmentoCarteraHipotesis: string | null;
  productosPrincipales: string | null;
  notas: string | null;
  fuentes: string[];
  researchModel: string;
  researchCostUsd: number;
}): Promise<EntityProfile> {
  const fuentesSql =
    params.fuentes.length === 0
      ? sql`ARRAY[]::text[]`
      : sql`ARRAY[${sql.join(params.fuentes.map((f) => sql`${f}`), sql`, `)}]::text[]`;

  const rows = await db.execute<DbRow>(sql`
    INSERT INTO gov.entity_profiles (
      nomb_correg, tipo_entidad, ubicacion, inicio_operaciones, ruc_sunat,
      publico_objetivo, modelo_negocio, segmento_cartera_hipotesis,
      productos_principales, notas, fuentes,
      research_at, research_model, research_cost_usd, research_count
    ) VALUES (
      ${params.nombCorreg}::text,
      ${params.tipoEntidad}::text,
      ${params.ubicacion}::text,
      ${params.inicioOperaciones}::text,
      ${params.rucSunat}::text,
      ${params.publicoObjetivo}::text,
      ${params.modeloNegocio}::text,
      ${params.segmentoCarteraHipotesis}::text,
      ${params.productosPrincipales}::text,
      ${params.notas}::text,
      ${fuentesSql},
      now(),
      ${params.researchModel}::text,
      ${params.researchCostUsd}::numeric,
      1
    )
    ON CONFLICT (nomb_correg) DO UPDATE SET
      tipo_entidad                = COALESCE(EXCLUDED.tipo_entidad, gov.entity_profiles.tipo_entidad),
      ubicacion                   = COALESCE(EXCLUDED.ubicacion, gov.entity_profiles.ubicacion),
      inicio_operaciones          = COALESCE(EXCLUDED.inicio_operaciones, gov.entity_profiles.inicio_operaciones),
      ruc_sunat                   = COALESCE(EXCLUDED.ruc_sunat, gov.entity_profiles.ruc_sunat),
      publico_objetivo            = COALESCE(EXCLUDED.publico_objetivo, gov.entity_profiles.publico_objetivo),
      modelo_negocio              = COALESCE(EXCLUDED.modelo_negocio, gov.entity_profiles.modelo_negocio),
      segmento_cartera_hipotesis  = COALESCE(EXCLUDED.segmento_cartera_hipotesis, gov.entity_profiles.segmento_cartera_hipotesis),
      productos_principales       = COALESCE(EXCLUDED.productos_principales, gov.entity_profiles.productos_principales),
      notas                       = COALESCE(EXCLUDED.notas, gov.entity_profiles.notas),
      fuentes                     = CASE
                                      WHEN array_length(EXCLUDED.fuentes, 1) > 0
                                        THEN EXCLUDED.fuentes
                                      ELSE gov.entity_profiles.fuentes
                                    END,
      research_at                 = EXCLUDED.research_at,
      research_model              = EXCLUDED.research_model,
      research_cost_usd           = gov.entity_profiles.research_cost_usd + EXCLUDED.research_cost_usd,
      research_count              = gov.entity_profiles.research_count + 1
    RETURNING *
  `);
  return rowToProfile(rows[0] as unknown as DbRow);
}

/**
 * Bump use_count y last_used_at al usar un perfil en un analisis.
 * Best-effort — si falla, no romper el analisis.
 */
export async function bumpUsage(nombCorregs: string[]): Promise<void> {
  if (nombCorregs.length === 0) return;
  const arrSql = sql`ARRAY[${sql.join(nombCorregs.map((v) => sql`${v}`), sql`, `)}]::text[]`;
  try {
    await db.execute(sql`
      UPDATE gov.entity_profiles
         SET use_count    = use_count + 1,
             last_used_at = now()
       WHERE nomb_correg = ANY(${arrSql})
    `);
  } catch {
    // best-effort
  }
}

/**
 * Marca perfil como validado por humano (admin UI).
 */
export async function verifyProfile(params: {
  nombCorreg: string;
  verifiedBy: string;
}): Promise<void> {
  await db.execute(sql`
    UPDATE gov.entity_profiles
       SET verified_by_human = true,
           verified_by       = ${params.verifiedBy},
           verified_at       = now()
     WHERE nomb_correg = ${params.nombCorreg}
  `);
}

/**
 * Lista paginada para admin UI.
 */
export async function listProfiles(params: {
  filter?: "all" | "verified" | "pending";
  limit?: number;
  offset?: number;
}): Promise<{ rows: EntityProfile[]; total: number }> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const filter = params.filter ?? "all";

  const whereClause =
    filter === "verified"
      ? sql`WHERE verified_by_human = true`
      : filter === "pending"
        ? sql`WHERE verified_by_human = false`
        : sql``;

  const totalRows = await db.execute<{ total: string }>(sql`
    SELECT COUNT(*)::text AS total FROM gov.entity_profiles ${whereClause}
  `);
  const total = Number(totalRows[0]?.total ?? 0);

  const rows = await db.execute<DbRow>(sql`
    SELECT * FROM gov.entity_profiles
    ${whereClause}
    ORDER BY updated_at DESC
    LIMIT ${limit}::int OFFSET ${offset}::int
  `);
  return {
    rows: rows.map((r) => rowToProfile(r as unknown as DbRow)),
    total,
  };
}
