import "server-only";

/**
 * Rate limit por IP para signup (V171).
 *
 * Objetivo: prevenir mass-signup attacks donde un script crea miles de
 * cuentas en minutos para bypasear limites de plan (10 API keys por cuenta
 * * 10k cuentas = 100k keys en paralelo).
 *
 * Politica:
 *   - 3 signups exitosos por IP en los ultimos 60 min → OK.
 *   - Al 4to intento en la misma ventana → 429.
 *   - Log de intento se guarda antes del check (para poder auditar
 *     intentos rechazados y detectar patrones).
 *
 * Uso: llamar desde hooks.before de Better Auth con el header IP resuelto.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";

const MAX_ATTEMPTS_PER_HOUR = 3;

/**
 * Extrae IP del request. Preferimos x-forwarded-for (proxy chain) sobre
 * x-real-ip. Fallback a "unknown" si no hay header — evita crashes en
 * dev/tests, pero en produccion Cloudflare/EasyPanel siempre inyecta uno.
 */
export function extractClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    // Primer IP en la cadena es el cliente real (los siguientes son proxies).
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = headers.get("x-real-ip");
  if (xri) return xri.trim();
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  return "0.0.0.0";
}

export type SignupCheckResult =
  | { allowed: true; recentAttempts: number }
  | { allowed: false; recentAttempts: number; retryAfterSeconds: number };

/**
 * Check + log de intento. Idempotente por naturaleza (el log siempre se
 * escribe, el check es una lectura). Devuelve `allowed: false` si excede el
 * cap. El caller decide como responder (429).
 *
 * Fail-open ante error de DB — mejor permitir signup legit que 500 al usuario.
 */
export async function checkAndLogSignupAttempt(
  ip: string,
  email: string | undefined,
): Promise<SignupCheckResult> {
  try {
    // Log del intento SIEMPRE (aun si va a ser rechazado) — util para
    // auditar patrones de ataque incluso cuando ya bloqueamos.
    await db.execute(sql`
      INSERT INTO auth.signup_attempts (ip_address, email)
      VALUES (${ip}::inet, ${email ?? null})
    `);

    const rows = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n
        FROM auth.signup_attempts
       WHERE ip_address = ${ip}::inet
         AND attempted_at >= now() - interval '60 minutes'
    `);
    const count = Number(rows[0]?.n ?? 0);

    if (count > MAX_ATTEMPTS_PER_HOUR) {
      // Wait time crudo: 60 min desde el intento mas viejo relevante.
      // Aproximacion suficiente para el header Retry-After.
      return {
        allowed: false,
        recentAttempts: count,
        retryAfterSeconds: 60 * 60,
      };
    }
    return { allowed: true, recentAttempts: count };
  } catch {
    // Fail-open ante DB error — no queremos que un problema de conexion
    // bloquee signups legit. La proteccion se degrada temporalmente.
    return { allowed: true, recentAttempts: 0 };
  }
}

/**
 * Marca el intento como exitoso. Se llama despues del signup exitoso via
 * databaseHooks.user.create.after — nos permite distinguir en analytics
 * entre attempts totales vs cuentas efectivamente creadas.
 */
export async function markSignupAttemptSuccess(
  ip: string,
  email: string,
): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE auth.signup_attempts
         SET succeeded = true
       WHERE ip_address = ${ip}::inet
         AND email = ${email}
         AND attempted_at >= now() - interval '5 minutes'
    `);
  } catch {
    /* swallow */
  }
}
