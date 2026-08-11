/**
 * Service del dominio publicaciones.
 *
 * Flujo generate:
 *   1. Resolver template por tema
 *   2. Rate limit check (reusa admin.check_insights_rate_limit)
 *   3. Resolver LLM provider via vault
 *   4. Ejecutar prompt (Claude Haiku, maxTokens=6000)
 *   5. Parsear output JSON {titulo, contenidoMd, hashtags}
 *   6. INSERT en admin.publicaciones
 *   7. Registrar usage
 *   8. Retornar la publicacion completa
 *
 * Otras funciones: list (con filtros por status/autor), get, update, delete.
 */

import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import { getProviderForCliente, LlmProviderError } from "@/lib/domains/llm-vault";
import { promptBenchmarkingSectorial } from "./prompts/benchmarking-sectorial";
import { promptCoyunturaMacro } from "./prompts/coyuntura-macro";
import { promptDupontRentabilidad } from "./prompts/dupont-rentabilidad";
import { promptEvolucionPeSegmento } from "./prompts/evolucion-pe-segmento";
import { promptMoraVisual } from "./prompts/mora-visual";
import { promptRentabilidadVisual } from "./prompts/rentabilidad-visual";
import {
  publicacionPeriodoLabel,
  type PublicacionPromptTemplate,
} from "./prompts/base";
import type {
  GeneratePublicacionInput,
  Publicacion,
  PublicacionChart,
  PublicacionListItem,
  PublicacionPromptContext,
  PublicacionStatus,
  PublicacionTema,
} from "./types";

const PROMPT_REGISTRY: Record<PublicacionTema, PublicacionPromptTemplate> = {
  benchmarking_sectorial: promptBenchmarkingSectorial,
  coyuntura_macro: promptCoyunturaMacro,
  dupont_rentabilidad: promptDupontRentabilidad,
  evolucion_pe_segmento: promptEvolucionPeSegmento,
  mora_visual: promptMoraVisual,
  rentabilidad_visual: promptRentabilidadVisual,
};

export class PublicacionesError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "rate_limit"
      | "no_provider"
      | "llm_error"
      | "parse_error"
      | "unsupported_tema"
      | "not_found"
      | "forbidden",
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PublicacionesError";
  }
}

/** Convierte una row cruda de la DB a Publicacion tipada. */
function rowToPublicacion(r: Record<string, unknown>): Publicacion {
  return {
    id: String(r.id),
    tema: r.tema as PublicacionTema,
    titulo: String(r.titulo),
    contenidoMd: String(r.contenido_md),
    hashtags: (r.hashtags as string[] | null) ?? [],
    charts: Array.isArray(r.charts) ? (r.charts as PublicacionChart[]) : [],
    clienteSlug: r.cliente_slug == null ? null : String(r.cliente_slug),
    periodo: Number(r.periodo),
    entidadPropia: String(r.entidad_propia),
    peerGroup: (r.peer_group as string[] | null) ?? [],
    model: String(r.model),
    promptVersion: String(r.prompt_version),
    tokensInput: Number(r.tokens_input),
    tokensOutput: Number(r.tokens_output),
    costUsd: Number(r.cost_usd),
    durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
    status: r.status as PublicacionStatus,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    publishedAt: r.published_at == null ? null : String(r.published_at),
    createdBy: String(r.created_by),
    publishedBy: r.published_by == null ? null : String(r.published_by),
  };
}

function rowToListItem(r: Record<string, unknown>): PublicacionListItem {
  return {
    id: String(r.id),
    tema: r.tema as PublicacionTema,
    titulo: String(r.titulo),
    periodo: Number(r.periodo),
    entidadPropia: String(r.entidad_propia),
    clienteSlug: r.cliente_slug == null ? null : String(r.cliente_slug),
    status: r.status as PublicacionStatus,
    updatedAt: String(r.updated_at),
    createdAt: String(r.created_at),
    publishedAt: r.published_at == null ? null : String(r.published_at),
    tokensInput: Number(r.tokens_input),
    tokensOutput: Number(r.tokens_output),
    costUsd: Number(r.cost_usd),
  };
}

/**
 * Genera una publicacion nueva (siempre NEW — no hay cache cross-user).
 */
export async function generatePublicacion(
  input: GeneratePublicacionInput,
  actor: { email: string },
): Promise<Publicacion> {
  const template = PROMPT_REGISTRY[input.tema];
  if (!template) {
    throw new PublicacionesError(
      `Tema '${input.tema}' no tiene prompt template implementado`,
      "unsupported_tema",
    );
  }

  // Rate limit — reusa la infraestructura de insights (mismos limites por
  // usuario/cliente). Trade-off: cuenta el mismo pool. Alternativa futura:
  // rate limit propio para publicaciones (mas heavy pero mas raro).
  const rateCheck = await db.execute<{ result: Record<string, unknown> }>(sql`
    SELECT admin.check_insights_rate_limit(${input.clienteSlug}::text, ${actor.email}::text) AS result
  `);
  const rl = rateCheck[0]?.result;
  if (rl && rl.allowed === false) {
    throw new PublicacionesError(
      `Rate limit alcanzado: ${rl.reason}`,
      "rate_limit",
      rl as Record<string, unknown>,
    );
  }

  // Resolver provider
  let provider;
  try {
    provider = await getProviderForCliente(input.clienteSlug);
  } catch (err) {
    if (err instanceof LlmProviderError) {
      throw new PublicacionesError(err.message, "no_provider");
    }
    throw err;
  }

  const promptCtx: PublicacionPromptContext = {
    ...input,
    periodoLabel: publicacionPeriodoLabel(input.periodo),
  };
  const { system, user } = template.build(promptCtx);

  // Long-form necesita mas tokens que bullets. 6000 permite ~800 palabras
  // + overhead JSON. Por debajo se trunca a mitad de articulo.
  const t0 = Date.now();
  let result;
  try {
    result = await provider.generate(user, { system, maxTokens: 6000 });
  } catch (err) {
    throw new PublicacionesError(
      err instanceof Error ? err.message : String(err),
      "llm_error",
    );
  }
  const durationMs = Date.now() - t0;

  // Parsear JSON output
  const parsed = parseArticuloJson(result.text);
  if (!parsed) {
    throw new PublicacionesError(
      `LLM devolvio output no parseable. Raw: ${result.text.slice(0, 200)}`,
      "parse_error",
    );
  }

  // Hashtags: usar los del LLM si son validos, sino fallback a defaults del template
  const hashtags =
    parsed.hashtags.length > 0 ? parsed.hashtags : template.hashtagsDefault;

  // INSERT — arrays con literal ARRAY[...]::text[] (mismo pattern que insights)
  const hashtagsSql =
    hashtags.length === 0
      ? sql`ARRAY[]::text[]`
      : sql`ARRAY[${sql.join(hashtags.map((h) => sql`${h}`), sql`, `)}]::text[]`;
  const peerGroupSql =
    input.peerGroup.length === 0
      ? sql`ARRAY[]::text[]`
      : sql`ARRAY[${sql.join(input.peerGroup.map((p) => sql`${p}`), sql`, `)}]::text[]`;

  const chartsJson = JSON.stringify(input.charts ?? []);

  const inserted = await db.execute<Record<string, unknown>>(sql`
    INSERT INTO admin.publicaciones (
      tema, titulo, contenido_md, hashtags, charts,
      cliente_slug, periodo, entidad_propia, peer_group,
      contexto_json,
      model, prompt_version,
      tokens_input, tokens_output, cost_usd, duration_ms,
      status, created_by
    ) VALUES (
      ${input.tema}::text,
      ${parsed.titulo}::text,
      ${parsed.contenidoMd}::text,
      ${hashtagsSql},
      ${chartsJson}::jsonb,
      ${input.clienteSlug}::text,
      ${input.periodo}::int,
      ${input.entidadPropia}::text,
      ${peerGroupSql},
      ${JSON.stringify(input.contexto)}::jsonb,
      ${result.model}::text,
      ${template.version}::text,
      ${result.usage.inputTokens}::int,
      ${result.usage.outputTokens}::int,
      ${result.usage.costUsd}::numeric,
      ${durationMs}::int,
      'draft'::text,
      ${`user:${actor.email}`}::text
    )
    RETURNING *
  `);
  const row = inserted[0];
  if (!row) {
    throw new PublicacionesError(
      "INSERT en admin.publicaciones no devolvio la fila",
      "llm_error",
    );
  }

  // Registrar usage — best effort
  await db
    .execute(sql`
      INSERT INTO admin.insights_user_usage
        (user_email, cliente_slug, periodo, seccion, cost_usd)
      VALUES (
        ${actor.email}::text,
        ${input.clienteSlug}::text,
        ${input.periodo}::int,
        ${`publicacion:${input.tema}`}::text,
        ${result.usage.costUsd}::numeric
      )
    `)
    .catch(() => { /* no romper la generacion */ });

  return rowToPublicacion(row);
}

/**
 * Lista publicaciones del usuario (por default excluye archivadas).
 * Admin ve todo — pero eso lo controla la API route via requireSession/isAdmin.
 */
export async function listPublicaciones(opts: {
  createdBy?: string;
  status?: PublicacionStatus[];
  limit?: number;
}): Promise<PublicacionListItem[]> {
  const limit = opts.limit ?? 100;
  const conditions = [sql`1=1`];
  if (opts.createdBy) {
    conditions.push(sql`created_by = ${opts.createdBy}::text`);
  }
  if (opts.status && opts.status.length > 0) {
    const statusList = sql.join(opts.status.map((s) => sql`${s}`), sql`, `);
    conditions.push(sql`status IN (${statusList})`);
  } else {
    conditions.push(sql`status <> 'archived'`);
  }
  const whereClause = sql.join(conditions, sql` AND `);

  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT id, tema, titulo, periodo, entidad_propia, cliente_slug,
           status, updated_at, created_at, published_at,
           tokens_input, tokens_output, cost_usd
      FROM admin.publicaciones
     WHERE ${whereClause}
     ORDER BY updated_at DESC
     LIMIT ${limit}
  `);
  return rows.map(rowToListItem);
}

export async function getPublicacion(id: string): Promise<Publicacion | null> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT * FROM admin.publicaciones WHERE id = ${id}::uuid LIMIT 1
  `);
  return rows[0] ? rowToPublicacion(rows[0]) : null;
}

/**
 * Update parcial: titulo, contenidoMd, hashtags, status. Solo el creador
 * puede editar sus publicaciones (o admin, controlado en la API route).
 */
export async function updatePublicacion(
  id: string,
  updates: {
    titulo?: string;
    contenidoMd?: string;
    hashtags?: string[];
    status?: PublicacionStatus;
    publishedBy?: string; // requerido si status pasa a 'published'
  },
): Promise<Publicacion> {
  const existing = await getPublicacion(id);
  if (!existing) {
    throw new PublicacionesError("Publicacion no encontrada", "not_found");
  }

  // Construir SET clauses dinamicos
  const sets: ReturnType<typeof sql>[] = [];
  if (updates.titulo !== undefined) {
    sets.push(sql`titulo = ${updates.titulo}::text`);
  }
  if (updates.contenidoMd !== undefined) {
    sets.push(sql`contenido_md = ${updates.contenidoMd}::text`);
  }
  if (updates.hashtags !== undefined) {
    const tagsSql =
      updates.hashtags.length === 0
        ? sql`ARRAY[]::text[]`
        : sql`ARRAY[${sql.join(updates.hashtags.map((h) => sql`${h}`), sql`, `)}]::text[]`;
    sets.push(sql`hashtags = ${tagsSql}`);
  }
  if (updates.status !== undefined) {
    sets.push(sql`status = ${updates.status}::text`);
    if (updates.status === "published") {
      sets.push(sql`published_at = now()`);
      if (updates.publishedBy) {
        sets.push(sql`published_by = ${updates.publishedBy}::text`);
      }
    }
  }

  if (sets.length === 0) return existing;

  const setClause = sql.join(sets, sql`, `);
  const updated = await db.execute<Record<string, unknown>>(sql`
    UPDATE admin.publicaciones
       SET ${setClause}
     WHERE id = ${id}::uuid
     RETURNING *
  `);
  const row = updated[0];
  if (!row) {
    throw new PublicacionesError("Publicacion no encontrada", "not_found");
  }
  return rowToPublicacion(row);
}

/** Soft delete: marca como 'archived'. Hard delete via /admin. */
export async function archivePublicacion(id: string): Promise<void> {
  await db.execute(sql`
    UPDATE admin.publicaciones
       SET status = 'archived'
     WHERE id = ${id}::uuid
  `);
}

/**
 * Parsea el output del LLM como JSON con shape {titulo, contenidoMd, hashtags}.
 * Tolera markdown fences y truncados al final del JSON.
 */
function parseArticuloJson(text: string): {
  titulo: string;
  contenidoMd: string;
  hashtags: string[];
} | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.titulo === "string" &&
      typeof parsed.contenidoMd === "string"
    ) {
      const hashtags = Array.isArray(parsed.hashtags)
        ? parsed.hashtags.filter((h: unknown): h is string => typeof h === "string")
        : [];
      return {
        titulo: parsed.titulo.trim(),
        contenidoMd: parsed.contenidoMd.trim(),
        hashtags,
      };
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

// PUBLICACION_TEMAS_META vive en ./meta.ts para ser client-safe (no
// arrastra "server-only" al bundle del client). Ver meta.ts.
