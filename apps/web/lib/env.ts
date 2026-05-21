/**
 * Validacion centralizada de variables de entorno con zod.
 *
 * Reglas:
 * - Llamar `env()` SOLO en runtime (route handlers, server actions, services).
 * - NO llamar en module load top-level: Next.js build evalua los modulos sin
 *   DATABASE_URL et al., y romperia la build.
 * - La validacion es lazy y cacheada — el primer acceso valida; despues
 *   devuelve la version cacheada.
 *
 * Para vars que necesitan estar disponibles en build time (typed routes,
 * imagenes, links absolutos), usar `process.env.XYZ` directo con default.
 */

import { z } from "zod";

const schema = z.object({
  // Runtime
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),

  // Auth — Better Auth
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET debe tener al menos 32 chars (recomendado 64+)"),
  BETTER_AUTH_URL: z.string().url("BETTER_AUTH_URL debe ser una URL valida"),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url(),

  // OAuth (opcionales hasta que configures las credenciales)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Observabilidad (opcionales)
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),

  // Email (opcional — Fase 4)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // Stripe (opcional — Fase 5)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;

  const result = schema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const formatted = Object.entries(errors)
      .map(([key, msgs]) => `  - ${key}: ${msgs?.join(", ")}`)
      .join("\n");
    throw new Error(`[env] Variables de entorno invalidas:\n${formatted}`);
  }
  cached = result.data;
  return cached;
}

/**
 * Para usar en assertions de runtime cuando solo se necesita garantizar
 * que una var existe sin acceder a env() completo.
 */
export function requireEnv(key: keyof Env): string {
  const value = process.env[key];
  if (!value) throw new Error(`[env] ${key} no definida`);
  return value;
}
