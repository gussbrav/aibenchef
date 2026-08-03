/**
 * Crypto helpers del LLM vault.
 *
 * Wraps las funciones SQL admin.encrypt_api_key / admin.decrypt_api_key
 * definidas en V140. La master key vive UNICAMENTE en env var
 * LLM_VAULT_MASTER_KEY del contenedor Next.js (server-side only).
 *
 * SEGURIDAD:
 * - La master key NUNCA sale del servidor. Estos helpers solo se pueden
 *   usar en API routes / server actions / SSR — usarlos en client
 *   components es un error de compilacion.
 * - Comprometer solo la DB no da acceso a las api keys (falta master).
 * - Comprometer solo el server no da acceso (las keys viven en DB).
 * - Master key se genera con `openssl rand -hex 32` (256 bits entropy).
 */

import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";

/**
 * Retorna la master key del env. Falla explicito si no esta seteada
 * (mejor error clara al arrancar que fallos raros al descifrar).
 */
function getMasterKey(): string {
  const key = process.env.LLM_VAULT_MASTER_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      "LLM_VAULT_MASTER_KEY no configurada o < 32 chars. " +
        "Generar con: openssl rand -hex 32 y agregar a env de EasyPanel.",
    );
  }
  return key;
}

/**
 * Cifra una API key para persistirla en admin.llm_providers.api_key_encrypted.
 * Devuelve un Buffer (BYTEA en Postgres) o null si el input es null/vacio
 * (para providers self-hosted sin auth como Ollama local).
 */
export async function encryptApiKey(plain: string | null | undefined): Promise<Buffer | null> {
  if (!plain) return null;
  const masterKey = getMasterKey();
  const rows = await db.execute<{ encrypted: Buffer | null }>(sql`
    SELECT admin.encrypt_api_key(${plain}::text, ${masterKey}::text) AS encrypted
  `);
  return rows[0]?.encrypted ?? null;
}

/**
 * Descifra una API key previamente cifrada. Devuelve null si el input
 * es null. Lanza excepcion si la master key es incorrecta o el bytea
 * esta corrupto — mejor propagar el error que devolver una key basura.
 */
export async function decryptApiKey(encrypted: Buffer | null | undefined): Promise<string | null> {
  if (!encrypted) return null;
  const masterKey = getMasterKey();
  const rows = await db.execute<{ decrypted: string | null }>(sql`
    SELECT admin.decrypt_api_key(${encrypted}::bytea, ${masterKey}::text) AS decrypted
  `);
  return rows[0]?.decrypted ?? null;
}

/**
 * Extrae los ultimos 4 chars visibles de una api key para display en UI.
 * Ejemplo: "sk-ant-api03-abc...XYZ" -> "sk-ant-...gAAB"
 * Nunca expone chars intermedios.
 */
export function hintFromApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const prefix = key.slice(0, 7); // ej: "sk-ant-"
  const suffix = key.slice(-4);   // ultimos 4
  return `${prefix}...${suffix}`;
}
