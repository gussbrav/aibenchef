/**
 * CRUD del vault de credenciales LLM.
 *
 * Toda escritura pasa por aca — nunca INSERT/UPDATE directo a
 * admin.llm_providers desde otras capas. Motivos:
 *   1. Encriptacion consistente de api_key_encrypted
 *   2. Calculo automatico de api_key_hint
 *   3. Insercion sincronica de audit log
 *   4. Validacion de invariantes (unique default por scope)
 */

import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import { encryptApiKey, decryptApiKey, hintFromApiKey } from "./crypto";
import type {
  LlmAuditAction,
  LlmProviderInput,
  LlmProviderPublic,
  ProviderType,
} from "./types";

type LlmProviderRow = {
  id: string;
  provider_type: string;
  display_name: string;
  model: string;
  api_key_hint: string | null;
  has_api_key: boolean;
  base_url: string | null;
  cliente_slug: string | null;
  is_active: boolean;
  is_default: boolean;
  max_tokens_output: number;
  temperature: string | number;
  created_by_email: string;
  created_at: string;
  updated_at: string;
  rotated_at: string | null;
  last_used_at: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
};

function toPublic(r: LlmProviderRow): LlmProviderPublic {
  return {
    id: r.id,
    providerType: r.provider_type as ProviderType,
    displayName: r.display_name,
    model: r.model,
    apiKeyHint: r.api_key_hint,
    hasApiKey: Boolean(r.has_api_key),
    baseUrl: r.base_url,
    clienteSlug: r.cliente_slug,
    isActive: r.is_active,
    isDefault: r.is_default,
    maxTokensOutput: Number(r.max_tokens_output),
    temperature: Number(r.temperature),
    createdByEmail: r.created_by_email,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    rotatedAt: r.rotated_at,
    lastUsedAt: r.last_used_at,
    lastTestAt: r.last_test_at,
    lastTestOk: r.last_test_ok,
    lastTestError: r.last_test_error,
  };
}

/**
 * Lista todos los providers desde la vista sanitizada. Nunca expone
 * api_key_encrypted. Ordenados por: default primero, luego por scope
 * (globales antes que scoped), luego por displayName.
 */
export async function listProviders(opts?: {
  clienteSlug?: string;
  onlyActive?: boolean;
}): Promise<LlmProviderPublic[]> {
  const filtroCliente = opts?.clienteSlug
    ? sql`AND (cliente_slug IS NULL OR cliente_slug = ${opts.clienteSlug})`
    : sql``;
  const filtroActive = opts?.onlyActive ? sql`AND is_active = true` : sql``;

  const rows = await db.execute<LlmProviderRow>(sql`
    SELECT * FROM admin.v_llm_providers_public
    WHERE 1=1 ${filtroCliente} ${filtroActive}
    ORDER BY is_default DESC,
             (cliente_slug IS NOT NULL) ASC,
             display_name ASC
  `);
  return rows.map(toPublic);
}

export async function getProviderById(id: string): Promise<LlmProviderPublic | null> {
  const rows = await db.execute<LlmProviderRow>(sql`
    SELECT * FROM admin.v_llm_providers_public WHERE id = ${id}::uuid
  `);
  const r = rows[0];
  return r ? toPublic(r) : null;
}

/**
 * Crea un nuevo provider. Cifra la api key (si viene) y registra
 * en el audit log.
 */
export async function createProvider(
  input: LlmProviderInput,
  actor: { email: string; ip?: string | null },
): Promise<LlmProviderPublic> {
  const encrypted = await encryptApiKey(input.apiKey);
  const hint = hintFromApiKey(input.apiKey);

  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO admin.llm_providers (
      provider_type, display_name, model,
      api_key_encrypted, api_key_hint,
      base_url, cliente_slug,
      is_active, is_default,
      max_tokens_output, temperature,
      created_by_email, rotated_at
    ) VALUES (
      ${input.providerType}::text,
      ${input.displayName}::text,
      ${input.model}::text,
      ${encrypted}::bytea,
      ${hint}::text,
      ${input.baseUrl ?? null}::text,
      ${input.clienteSlug ?? null}::text,
      ${input.isActive ?? true}::boolean,
      ${input.isDefault ?? false}::boolean,
      ${input.maxTokensOutput ?? 800}::int,
      ${input.temperature ?? 0.3}::numeric,
      ${actor.email}::text,
      ${encrypted ? sql`now()` : sql`NULL`}
    )
    RETURNING id
  `);
  const id = rows[0]!.id;

  await recordAudit(id, "created", actor, {
    display_name: input.displayName,
    provider_type: input.providerType,
    has_key: Boolean(encrypted),
  });

  const created = await getProviderById(id);
  if (!created) throw new Error("Provider creado pero no encontrado");
  return created;
}

/**
 * Actualiza un provider existente. Si viene apiKey nueva, se cifra y
 * se marca como rotacion. Registra audit correspondiente.
 */
export async function updateProvider(
  id: string,
  input: Partial<LlmProviderInput> & { rotateApiKey?: boolean },
  actor: { email: string; ip?: string | null },
): Promise<LlmProviderPublic | null> {
  const current = await getProviderById(id);
  if (!current) return null;

  const rotating = input.apiKey !== undefined && input.rotateApiKey !== false;
  const encrypted = rotating ? await encryptApiKey(input.apiKey) : undefined;
  const hint = rotating ? hintFromApiKey(input.apiKey ?? null) : undefined;

  await db.execute(sql`
    UPDATE admin.llm_providers SET
      provider_type      = COALESCE(${input.providerType ?? null}::text, provider_type),
      display_name       = COALESCE(${input.displayName ?? null}::text, display_name),
      model              = COALESCE(${input.model ?? null}::text, model),
      ${rotating
        ? sql`api_key_encrypted = ${encrypted}::bytea, api_key_hint = ${hint}::text,`
        : sql``}
      base_url           = COALESCE(${input.baseUrl ?? null}::text, base_url),
      cliente_slug       = ${input.clienteSlug === undefined ? sql`cliente_slug` : sql`${input.clienteSlug}::text`},
      is_active          = COALESCE(${input.isActive ?? null}::boolean, is_active),
      is_default         = COALESCE(${input.isDefault ?? null}::boolean, is_default),
      max_tokens_output  = COALESCE(${input.maxTokensOutput ?? null}::int, max_tokens_output),
      temperature        = COALESCE(${input.temperature ?? null}::numeric, temperature)
    WHERE id = ${id}::uuid
  `);

  await recordAudit(id, rotating ? "key_rotated" : "updated", actor, {
    fields_changed: Object.keys(input).filter((k) => k !== "apiKey" && k !== "rotateApiKey"),
    key_rotated: rotating,
  });

  return getProviderById(id);
}

export async function deleteProvider(
  id: string,
  actor: { email: string; ip?: string | null },
): Promise<boolean> {
  const existing = await getProviderById(id);
  if (!existing) return false;

  await db.execute(sql`DELETE FROM admin.llm_providers WHERE id = ${id}::uuid`);
  await recordAudit(id, "deleted", actor, {
    display_name: existing.displayName,
    provider_type: existing.providerType,
  });
  return true;
}

/**
 * Marca un provider como default. Desmarca cualquier otro con el mismo
 * scope (global o cliente_slug). Transaccional.
 */
export async function setDefaultProvider(
  id: string,
  actor: { email: string; ip?: string | null },
): Promise<boolean> {
  const target = await getProviderById(id);
  if (!target) return false;

  await db.execute(sql`
    UPDATE admin.llm_providers
       SET is_default = false
     WHERE COALESCE(cliente_slug, '') = ${target.clienteSlug ?? ""}
       AND id <> ${id}::uuid
       AND is_default = true
  `);
  await db.execute(sql`
    UPDATE admin.llm_providers SET is_default = true WHERE id = ${id}::uuid
  `);

  await recordAudit(id, "set_default", actor, {
    scope: target.clienteSlug ?? "global",
  });
  return true;
}

/**
 * Registra el resultado de un test de conexion en la fila del provider
 * (last_test_at, last_test_ok, last_test_error) y en el audit log.
 */
export async function recordTestResult(
  id: string,
  ok: boolean,
  error: string | null,
  actor: { email: string; ip?: string | null },
): Promise<void> {
  await db.execute(sql`
    UPDATE admin.llm_providers SET
      last_test_at    = now(),
      last_test_ok    = ${ok}::boolean,
      last_test_error = ${error}::text
    WHERE id = ${id}::uuid
  `);
  await recordAudit(id, ok ? "test_success" : "test_failed", actor, {
    error: error ?? undefined,
  });
}

/**
 * Interna: descifra la api key de un provider para pasarla al SDK.
 * NUNCA exponer este metodo por HTTP — solo consumo interno del factory.
 */
export async function getDecryptedApiKey(id: string): Promise<string | null> {
  const rows = await db.execute<{ api_key_encrypted: Buffer | null }>(sql`
    SELECT api_key_encrypted FROM admin.llm_providers WHERE id = ${id}::uuid
  `);
  const encrypted = rows[0]?.api_key_encrypted;
  return decryptApiKey(encrypted);
}

/** Registra un evento en admin.llm_provider_audit. Silenciosos best-effort. */
async function recordAudit(
  providerId: string,
  action: LlmAuditAction,
  actor: { email: string; ip?: string | null },
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO admin.llm_provider_audit (provider_id, action, actor_email, actor_ip, metadata)
      VALUES (
        ${providerId}::uuid,
        ${action}::text,
        ${actor.email}::text,
        ${actor.ip ?? null}::inet,
        ${JSON.stringify(metadata)}::jsonb
      )
    `);
  } catch {
    // Audit best-effort — no romper la operacion principal si falla el log
  }
}
