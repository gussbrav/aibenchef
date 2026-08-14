import "server-only";

/**
 * Dominio api-keys — gestion de API keys para consumo programatico
 * de /api/public/v1/*.
 *
 * Modelo de seguridad:
 *   - El token completo (aibchf_...) solo existe en memoria durante la
 *     creacion. Al user se le devuelve UNA VEZ y se guarda solo el
 *     SHA-256 en DB.
 *   - Verificacion en constant-time via comparacion de hashes (no de
 *     strings — evita timing attacks incluso con hash mismatch).
 *   - Revoke es soft-delete (revoked_at) para auditar.
 *   - Rate limit via auth.count_api_key_requests_last_minute + record_api_key_usage.
 *
 * Consumido desde:
 *   - /dashboard/settings/api-keys (UI de gestion CRUD)
 *   - /api/v1/settings/api-keys (endpoints REST)
 *   - middleware de /api/public/v1/* (verify + rate limit)
 */

import { randomBytes, createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { NotFoundError, ForbiddenError } from "@/lib/domains/shared";

const TOKEN_PREFIX = "aibchf_";
const TOKEN_ENTROPY_BYTES = 32; // 256 bits, > que suficiente

export type ApiKey = {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  note: string | null;
};

/** Vista publica de una API key para el UI — NO incluye token_hash. */
export type ApiKeyPublic = Omit<ApiKey, "userId"> & { userId: string };

/**
 * Resultado de crear una key. El plainToken solo se devuelve UNA VEZ
 * al momento de la creacion — el UI debe mostrarselo al user con la
 * advertencia "guardalo bien, no lo podras ver de nuevo".
 */
export type CreatedApiKey = ApiKeyPublic & { plainToken: string };

// ============================================================================
// Helpers de hashing / token generation
// ============================================================================

function generateToken(): { plain: string; prefix: string; last4: string; hash: string } {
  const raw = randomBytes(TOKEN_ENTROPY_BYTES);
  // base64url (no +/=), 43 chars para 32 bytes
  const body = raw
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const plain = `${TOKEN_PREFIX}${body}`;
  const prefix = `${TOKEN_PREFIX}${body.slice(0, 4)}`;
  const last4 = body.slice(-4);
  const hash = sha256Hex(plain);
  return { plain, prefix, last4, hash };
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Comparacion constant-time de dos strings hex. Node's timingSafeEqual
 * requiere buffers de igual longitud — hex de SHA-256 siempre 64 chars.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  try {
    // Import late para no cargar en cold path
    const { timingSafeEqual } = require("node:crypto") as {
      timingSafeEqual: (a: Buffer, b: Buffer) => boolean;
    };
    return timingSafeEqual(bufA, bufB);
  } catch {
    // Fallback (nunca deberia pasar en Node 20+)
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
      mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
  }
}

function mapRow(r: Record<string, unknown>): ApiKey {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    name: String(r.name),
    prefix: String(r.prefix),
    last4: String(r.last4),
    createdAt: new Date(r.created_at as string | Date).toISOString(),
    lastUsedAt: r.last_used_at
      ? new Date(r.last_used_at as string | Date).toISOString()
      : null,
    revokedAt: r.revoked_at
      ? new Date(r.revoked_at as string | Date).toISOString()
      : null,
    note: (r.note as string | null) ?? null,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Crea una nueva API key para el user. Devuelve el token en clear una
 * unica vez. Impone maximo 10 keys activas por user para evitar abuso.
 */
export async function createApiKey(input: {
  userId: string;
  name: string;
  note?: string | null;
}): Promise<CreatedApiKey> {
  // Cap suave: max 10 keys ACTIVAS por user. Si tiene mas, exige revoke primero.
  const [countRow] = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
      FROM auth.api_keys
     WHERE user_id = ${input.userId}::uuid
       AND revoked_at IS NULL
  `);
  if ((countRow?.n ?? 0) >= 10) {
    throw new ForbiddenError(
      "Alcanzaste el limite de 10 API keys activas. Revoca alguna antes de crear otra.",
      { limit: 10 },
    );
  }

  const { plain, prefix, last4, hash } = generateToken();

  const [row] = await db.execute<Record<string, unknown>>(sql`
    INSERT INTO auth.api_keys (user_id, name, prefix, last4, token_hash, note)
    VALUES (
      ${input.userId}::uuid,
      ${input.name}::text,
      ${prefix}::text,
      ${last4}::text,
      ${hash}::text,
      ${input.note ?? null}
    )
    RETURNING *
  `);
  if (!row) {
    throw new Error("Failed to insert api_key row");
  }
  const created = mapRow(row);
  return { ...created, plainToken: plain };
}

/** Lista las API keys del user, incluyendo revocadas (para auditoria en UI). */
export async function listApiKeys(userId: string): Promise<ApiKeyPublic[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT *
      FROM auth.api_keys
     WHERE user_id = ${userId}::uuid
     ORDER BY revoked_at NULLS FIRST, created_at DESC
  `);
  return rows.map(mapRow);
}

/** Revoca una key. Idempotente (revocar 2 veces no falla). */
export async function revokeApiKey(input: {
  userId: string;
  apiKeyId: string;
}): Promise<void> {
  const result = await db.execute<Record<string, unknown>>(sql`
    UPDATE auth.api_keys
       SET revoked_at = COALESCE(revoked_at, now())
     WHERE id = ${input.apiKeyId}::uuid
       AND user_id = ${input.userId}::uuid
     RETURNING id
  `);
  if (result.length === 0) {
    throw new NotFoundError("API key no encontrada o no te pertenece", {
      apiKeyId: input.apiKeyId,
    });
  }
}

/**
 * Verifica un token contra la DB en constant-time. Devuelve la key
 * (con user_id + plan info) si es valida y no esta revocada. Devuelve
 * null en cualquier otro caso (nunca info sobre por que fallo — no
 * queremos que un atacante distinga entre "token invalido" y "revocado").
 */
export type VerifiedApiKey = {
  apiKeyId: string;
  userId: string;
  plan: string;
  role: string;
};

export async function verifyApiKey(token: string): Promise<VerifiedApiKey | null> {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  if (token.length < TOKEN_PREFIX.length + 16) return null;

  const hash = sha256Hex(token);
  // Buscamos por hash directo — el hash es unique + indexado. La
  // comparacion constant-time la agregamos EXTRA por defensa (aunque
  // Postgres compara bytes internamente, esto blinda contra timing en
  // el path de app antes de la query).
  const rows = await db.execute<{ id: string; user_id: string; token_hash: string; plan: string; role: string }>(sql`
    SELECT k.id, k.user_id, k.token_hash, u.plan, u.role
      FROM auth.api_keys k
      JOIN auth.users u ON u.id = k.user_id
     WHERE k.token_hash = ${hash}::text
       AND k.revoked_at IS NULL
     LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  if (!safeEqual(row.token_hash, hash)) return null;
  return {
    apiKeyId: String(row.id),
    userId: String(row.user_id),
    plan: String(row.plan),
    role: String(row.role),
  };
}

/** Registra 1 request en el contador rolling + bump last_used_at. */
export async function recordApiKeyUsage(apiKeyId: string): Promise<void> {
  await db.execute(sql`SELECT auth.record_api_key_usage(${apiKeyId}::uuid)`);
}

/** Cuenta requests de la key en los ultimos 60s (para rate limiting). */
export async function countApiKeyRequestsLastMinute(apiKeyId: string): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT auth.count_api_key_requests_last_minute(${apiKeyId}::uuid)::int AS n
  `);
  return row?.n ?? 0;
}

/** Rate limit por plan. Configuracion centralizada. */
export function rateLimitForPlan(plan: string): number {
  switch (plan) {
    case "academic":
      return 60;
    case "pro":
      return 300;
    case "business":
      return 600;
    default:
      // free y otros no deberian llegar aca (apiAccess=false), pero
      // por defensa devolvemos algo bajito.
      return 30;
  }
}

/**
 * Cap DIARIO por plan (V171). Complementa el rate limit por minuto: aunque
 * el attacker respete 60/min, no puede pasar de este cap diario.
 *
 * Calculo de proteccion:
 *   Universo SBS aprox: ~150k requests para descarga completa.
 *   Academic 500/dia = 300 dias (10 meses) para full scrape → tiempo suficiente
 *   para detectar patron anomalo y revocar key.
 *   Pro 5000/dia = 30 dias — sigue siendo detectable.
 *   Business 20000/dia = 7.5 dias — cliente enterprise legit no llega ni al 10%.
 */
export function dailyRateLimitForPlan(plan: string): number {
  switch (plan) {
    case "academic":
      return 500;
    case "pro":
      return 5000;
    case "business":
      return 20000;
    default:
      return 100;
  }
}

/** Cuenta requests de la key en el dia actual (V171). */
export async function countApiKeyRequestsToday(apiKeyId: string): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT COALESCE(request_count, 0)::int AS n
      FROM auth.api_key_daily_usage
     WHERE api_key_id = ${apiKeyId}::uuid
       AND usage_date = CURRENT_DATE
     LIMIT 1
  `);
  return row?.n ?? 0;
}

/**
 * Bump del contador diario (V171). Usa UPSERT para ser atomico bajo
 * concurrencia. Se llama junto con recordApiKeyUsage() (rolling minuto).
 */
export async function bumpApiKeyDailyUsage(apiKeyId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO auth.api_key_daily_usage (api_key_id, usage_date, request_count, first_at, last_at)
    VALUES (${apiKeyId}::uuid, CURRENT_DATE, 1, now(), now())
    ON CONFLICT (api_key_id, usage_date)
    DO UPDATE SET
      request_count = auth.api_key_daily_usage.request_count + 1,
      last_at = now()
  `);
}
