/**
 * Encriptacion at-rest para secretos (api keys, etc).
 *
 * Algoritmo: AES-256-GCM con IV aleatorio por encriptacion y auth tag.
 * Clave maestra: env var APP_ENCRYPTION_KEY (32 bytes en hex = 64 chars).
 *
 * Si APP_ENCRYPTION_KEY no esta seteado, derivamos una clave a partir de
 * BETTER_AUTH_SECRET (que ya debe tener 32+ chars). Esto es un fallback
 * para entornos dev/staging — en prod hay que setear APP_ENCRYPTION_KEY
 * explicito para que rotar Better Auth no invalide los secretos guardados.
 *
 * Formato del cipher text: "iv:tag:ciphertext" (cada uno hex).
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32; // 256 bits
const IV_LEN = 12; // 96 bits para GCM (recomendado)

let _masterKey: Buffer | null = null;

function masterKey(): Buffer {
  if (_masterKey) return _masterKey;
  const explicit = process.env.APP_ENCRYPTION_KEY;
  if (explicit && explicit.length >= 64) {
    // 32 bytes en hex
    const buf = Buffer.from(explicit.slice(0, 64), "hex");
    if (buf.length !== KEY_LEN) {
      throw new Error("APP_ENCRYPTION_KEY no es hex valido de 32 bytes");
    }
    _masterKey = buf;
    return buf;
  }
  // Fallback: derivar de BETTER_AUTH_SECRET via SHA-256
  const auth = process.env.BETTER_AUTH_SECRET;
  if (!auth || auth.length < 16) {
    throw new Error(
      "No se puede derivar clave de encriptacion: ni APP_ENCRYPTION_KEY ni BETTER_AUTH_SECRET estan seteadas con largo suficiente.",
    );
  }
  _masterKey = createHash("sha256").update(`aibenchef:${auth}`).digest();
  return _masterKey;
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const key = masterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(encoded: string | null | undefined): string | null {
  if (!encoded) return null;
  const parts = encoded.split(":");
  if (parts.length !== 3) {
    throw new Error("Formato de secreto encriptado invalido");
  }
  const [ivHex, tagHex, ctHex] = parts;
  const key = masterKey();
  const iv = Buffer.from(ivHex!, "hex");
  const tag = Buffer.from(tagHex!, "hex");
  const ct = Buffer.from(ctHex!, "hex");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString("utf8");
}

/**
 * Mascara una api key para mostrar en UI: primeros 4 + ultimos 4 con asteriscos.
 * Ej: "sk-ant-api-abcdef1234567890" -> "sk-a••••••••7890"
 */
export function maskSecret(plaintext: string | null | undefined): string {
  if (!plaintext) return "";
  if (plaintext.length <= 8) return "••••••••";
  return `${plaintext.slice(0, 4)}••••••••${plaintext.slice(-4)}`;
}
