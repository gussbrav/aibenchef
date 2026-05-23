import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/infrastructure/crypto";
import { NotFoundError, ValidationError, toIso } from "@/lib/domains/shared";

export type AiProviderId = "claude" | "openai" | "ollama" | "gemini";

export type AiProvider = {
  provider: AiProviderId;
  apiKeyConfigurado: boolean;
  apiKeyMasked: string; // jamas devolver plaintext al frontend
  baseUrl: string | null;
  modelDefault: string | null;
  enabled: boolean;
  notas: string | null;
  lastUpdatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapRow(r: Record<string, unknown>): AiProvider {
  const enc = r.api_key_encrypted as string | null;
  let masked = "";
  let configurado = false;
  if (enc) {
    configurado = true;
    try {
      const plain = decryptSecret(enc);
      masked = maskSecret(plain);
    } catch {
      masked = "(error al desencriptar — clave maestra puede haber cambiado)";
    }
  }
  return {
    provider: r.provider as AiProviderId,
    apiKeyConfigurado: configurado,
    apiKeyMasked: masked,
    baseUrl: (r.base_url as string | null) ?? null,
    modelDefault: (r.model_default as string | null) ?? null,
    enabled: Boolean(r.enabled),
    notas: (r.notas as string | null) ?? null,
    lastUpdatedBy: (r.last_updated_by as string | null) ?? null,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export async function listProviders(): Promise<AiProvider[]> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT provider, api_key_encrypted, base_url, model_default, enabled,
             notas, last_updated_by, created_at, updated_at
      FROM app.ai_providers
      ORDER BY provider
    `,
  );
  return rows.map(mapRow);
}

export async function getProvider(provider: AiProviderId): Promise<AiProvider> {
  const rows = await db.execute<Record<string, unknown>>(
    sql`
      SELECT provider, api_key_encrypted, base_url, model_default, enabled,
             notas, last_updated_by, created_at, updated_at
      FROM app.ai_providers
      WHERE provider = ${provider}
      LIMIT 1
    `,
  );
  if (rows.length === 0) {
    throw new NotFoundError(`Provider no encontrado: ${provider}`, {});
  }
  return mapRow(rows[0]!);
}

/**
 * Para uso INTERNO del backend (Genie, futuros agentes). Devuelve el plaintext
 * de la api key. NUNCA exponer este resultado al frontend.
 */
export async function getProviderApiKey(provider: AiProviderId): Promise<string | null> {
  const rows = await db.execute<{ api_key_encrypted: string | null; enabled: boolean }>(
    sql`
      SELECT api_key_encrypted, enabled
      FROM app.ai_providers
      WHERE provider = ${provider}
      LIMIT 1
    `,
  );
  const r = rows[0];
  if (!r || !r.enabled || !r.api_key_encrypted) return null;
  try {
    return decryptSecret(r.api_key_encrypted);
  } catch {
    return null;
  }
}

export async function getProviderBaseUrl(provider: AiProviderId): Promise<string | null> {
  const rows = await db.execute<{ base_url: string | null }>(
    sql`SELECT base_url FROM app.ai_providers WHERE provider = ${provider} LIMIT 1`,
  );
  return rows[0]?.base_url ?? null;
}

export type UpdateProviderInput = {
  apiKey?: string | null; // null = limpiar; undefined = no tocar
  baseUrl?: string | null;
  modelDefault?: string | null;
  enabled?: boolean;
  notas?: string | null;
};

export async function updateProvider(
  provider: AiProviderId,
  data: UpdateProviderInput,
  userId: string,
): Promise<AiProvider> {
  // Validar largo de api key
  if (data.apiKey && data.apiKey.length > 1024) {
    throw new ValidationError("API key muy larga", {});
  }
  if (data.baseUrl && data.baseUrl.length > 500) {
    throw new ValidationError("Base URL muy larga", {});
  }

  await getProvider(provider); // valida que exista

  const sets: ReturnType<typeof sql>[] = [];
  const acciones: Array<{ accion: string; detalle: string | null }> = [];

  if (data.apiKey !== undefined) {
    if (data.apiKey === null || data.apiKey.trim() === "") {
      sets.push(sql`api_key_encrypted = NULL`);
      acciones.push({ accion: "update_key", detalle: "API key limpiada" });
    } else {
      const enc = encryptSecret(data.apiKey.trim());
      sets.push(sql`api_key_encrypted = ${enc}`);
      acciones.push({
        accion: "update_key",
        detalle: `API key actualizada (${maskSecret(data.apiKey.trim())})`,
      });
    }
  }
  if (data.baseUrl !== undefined) {
    sets.push(sql`base_url = ${data.baseUrl}`);
    acciones.push({ accion: "update_url", detalle: data.baseUrl });
  }
  if (data.modelDefault !== undefined) {
    sets.push(sql`model_default = ${data.modelDefault}`);
    acciones.push({ accion: "update_model", detalle: data.modelDefault });
  }
  if (data.enabled !== undefined) {
    sets.push(sql`enabled = ${data.enabled}`);
    acciones.push({
      accion: "toggle_enabled",
      detalle: data.enabled ? "habilitado" : "deshabilitado",
    });
  }
  if (data.notas !== undefined) {
    sets.push(sql`notas = ${data.notas}`);
  }

  if (sets.length === 0) return getProvider(provider);

  sets.push(sql`last_updated_by = ${userId}`);

  await db.execute(
    sql`UPDATE app.ai_providers SET ${sql.join(sets, sql`, `)} WHERE provider = ${provider}`,
  );

  // Audit log
  for (const a of acciones) {
    try {
      await db.execute(
        sql`
          INSERT INTO app.ai_providers_audit (provider, accion, detalle, user_id)
          VALUES (${provider}, ${a.accion}, ${a.detalle}, ${userId})
        `,
      );
    } catch {
      // no bloquear
    }
  }

  return getProvider(provider);
}
