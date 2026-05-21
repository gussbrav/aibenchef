import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { db } from "@/lib/infrastructure/db";
import * as schema from "@/lib/infrastructure/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),

  // Postgres genera UUIDs via gen_random_uuid() (defaultRandom() en Drizzle).
  // Sin esto, Better Auth genera IDs como string random, lo que rompe los
  // INSERT contra columnas UUID (-> 422 FAILED_TO_CREATE_USER).
  advanced: {
    database: {
      generateId: false,
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // activar despues con Resend
    minPasswordLength: 8,
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },

  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 5,
      membershipLimit: 100,
    }),
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 dias
    updateAge: 60 * 60 * 24, // refresh diario
  },

  trustedOrigins: buildTrustedOrigins(),
});

/**
 * Dominios permitidos para auth (cookies + CORS de Better Auth).
 *
 * Por defecto: NEXT_PUBLIC_APP_URL (produccion canonica) + localhost (dev).
 * Adicionalmente: cualquier dominio extra en BETTER_AUTH_TRUSTED_ORIGINS
 * separado por coma (ej: dominio interno de EasyPanel para staging/preview).
 *
 * Necesario porque cuando el usuario accede por un host alternativo, el
 * Origin del browser difiere y Better Auth rechaza la request por seguridad.
 */
function buildTrustedOrigins(): string[] {
  const out = new Set<string>([
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    "http://localhost:3000",
  ]);
  const extra = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  if (extra) {
    for (const o of extra.split(",")) {
      const trimmed = o.trim();
      if (trimmed) out.add(trimmed);
    }
  }
  return [...out];
}

export type Session = typeof auth.$Infer.Session;
