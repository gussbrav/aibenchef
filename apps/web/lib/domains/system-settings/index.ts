/**
 * Domain: system_settings (key-value global, no per-tenant).
 *
 * Para configuracion runtime de la app sin redeploy: Resend API key,
 * feature flags globales, webhooks. Secrets se encriptan con AES-256-GCM.
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/infrastructure/crypto";
import {
  NotFoundError,
  ValidationError,
  toIso,
} from "@/lib/domains/shared";
import { requireAdmin } from "@/lib/domains/users";

export type SystemSetting = {
  key: string;
  value: string | null;       // plaintext si !is_secret, masked si is_secret
  isSecret: boolean;
  descripcion: string | null;
  updatedBy: string | null;
  updatedAt: string;
};

/**
 * Lee TODAS las settings. Los secrets vienen MASKED.
 * Solo admins pueden llamar.
 */
export async function listSystemSettings(actorId: string): Promise<SystemSetting[]> {
  await requireAdmin(actorId);
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT key, value, is_secret, descripcion, updated_by, updated_at
    FROM app.system_settings
    ORDER BY key
  `);
  return rows.map((r) => {
    const isSecret = Boolean(r.is_secret);
    let value: string | null = (r.value as string | null) ?? null;
    if (isSecret && value) {
      // Mostrar masked, nunca el ciphertext crudo
      const plain = decryptSecret(value);
      value = plain ? maskSecret(plain) : "(error)";
    }
    return {
      key: String(r.key),
      value,
      isSecret,
      descripcion: (r.descripcion as string | null) ?? null,
      updatedBy: (r.updated_by as string | null) ?? null,
      updatedAt: toIso(r.updated_at),
    };
  });
}

/**
 * INTERNO: lee el valor plaintext de una setting (descifra si es secret).
 * NO exponer a frontend. Solo usar desde server actions / endpoints
 * que necesiten consumir la setting (ej: sendEmail).
 */
export async function getSystemSettingValue(key: string): Promise<string | null> {
  const rows = await db.execute<{ value: string | null; is_secret: boolean }>(sql`
    SELECT value, is_secret FROM app.system_settings WHERE key = ${key} LIMIT 1
  `);
  const r = rows[0];
  if (!r) return null;
  if (!r.value) return null;
  if (r.is_secret) {
    try {
      return decryptSecret(r.value);
    } catch {
      return null;
    }
  }
  return r.value;
}

/**
 * Actualizar el value de una setting. Si is_secret=true, encripta.
 * Si value es vacio/null, lo limpia.
 */
export async function updateSystemSetting(
  actorId: string,
  key: string,
  rawValue: string | null,
): Promise<SystemSetting> {
  await requireAdmin(actorId);

  // Verificar que la setting existe (no permitir keys arbitrarias)
  const existing = await db.execute<{ is_secret: boolean }>(sql`
    SELECT is_secret FROM app.system_settings WHERE key = ${key} LIMIT 1
  `);
  if (existing.length === 0) {
    throw new NotFoundError(`Setting no existe: ${key}`, { key });
  }
  const isSecret = Boolean(existing[0]!.is_secret);

  const trimmed = rawValue?.trim();
  const newValue = !trimmed ? null : isSecret ? encryptSecret(trimmed) : trimmed;

  await db.execute(sql`
    UPDATE app.system_settings
    SET value = ${newValue},
        updated_by = ${actorId},
        updated_at = now()
    WHERE key = ${key}
  `);

  // Re-leer con masking
  const refreshed = await listSystemSettings(actorId);
  const setting = refreshed.find((s) => s.key === key);
  if (!setting) throw new NotFoundError(`Setting ${key} no encontrada`, {});
  return setting;
}
