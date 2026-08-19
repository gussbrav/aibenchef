import "server-only";

/**
 * Helpers de autenticacion para route handlers.
 *
 * Antes de esto, cada route.ts duplicaba el patron de auth.api.getSession()
 * con headers manuales (DRY violation + facil de olvidar en endpoints
 * nuevos). Esto centraliza el patron y deja claro cuando un endpoint
 * requiere sesion vs admin.
 *
 * Uso:
 *   export async function POST(req: NextRequest) {
 *     return handleRoute(async () => {
 *       const session = await requireSession();
 *       // ...
 *     });
 *   }
 */

import { cache } from "react";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/infrastructure/db";
import type { UserPlan } from "@/lib/plans";

import { UnauthorizedError, ForbiddenError } from "@/lib/domains/shared/errors";

/**
 * getServerSession — versión deduplicada de auth.api.getSession para
 * server components. Usa React.cache para que layout + page + subsecciones
 * hagan UNA sola llamada por request (antes eran 2-3 auth roundtrips
 * seriales que sumaban 100-300ms al TTFB).
 *
 * IMPORTANTE: solo dedupe DENTRO de un mismo request. Distintos requests
 * SI hacen el lookup — no hay caching cross-request (correcto, la sesion
 * puede expirar/cambiar).
 */
export const getServerSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export type SessionUser = {
  id: string;
  email: string;
  role?: string | null;
};

export async function requireSession(): Promise<SessionUser> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    throw new UnauthorizedError("Sesion requerida", {});
  }
  return {
    id: session.user.id,
    email: session.user.email,
    role: (session.user as { role?: string | null }).role ?? null,
  };
}

export async function requireAdminSession(): Promise<SessionUser> {
  const user = await requireSession();
  if (user.role !== "admin") {
    throw new ForbiddenError("Permisos insuficientes (requiere admin)", {});
  }
  return user;
}

/**
 * Devuelve el plan comercial del user. Deduplica por request via
 * React.cache. Fallback a 'free' si el user no existe.
 *
 * V173 fix: incluir 'trial' y 'academic'. Antes retornaba 'free' para
 * academic (bug — el enforcement estaba bien, pero UI se confundia).
 */
export const getUserPlan = cache(async (userId: string): Promise<UserPlan> => {
  try {
    const rows = await db.execute<{ plan: string | null }>(sql`
      SELECT plan FROM auth.users WHERE id = ${userId}::uuid LIMIT 1
    `);
    const p = rows[0]?.plan;
    if (
      p === "trial" ||
      p === "pro" ||
      p === "business" ||
      p === "free" ||
      p === "academic"
    ) {
      return p;
    }
  } catch {
    /* fallback silencioso a free */
  }
  return "free";
});

/**
 * V173: devuelve el plan + expiration para el trial badge / banner.
 * Una sola query (deduplicada por request). planExpiresAtIso es null si
 * el plan no expira (free, planes perpetuos hechos por admin).
 */
export const getUserPlanContext = cache(
  async (
    userId: string,
  ): Promise<{ plan: UserPlan; planExpiresAtIso: string | null }> => {
    try {
      const rows = await db.execute<{
        plan: string | null;
        plan_expires_at: string | null;
      }>(sql`
        SELECT plan, plan_expires_at::text AS plan_expires_at
          FROM auth.users
         WHERE id = ${userId}::uuid
         LIMIT 1
      `);
      const p = rows[0]?.plan;
      if (
        p === "trial" ||
        p === "pro" ||
        p === "business" ||
        p === "free" ||
        p === "academic"
      ) {
        return {
          plan: p,
          planExpiresAtIso: rows[0]?.plan_expires_at ?? null,
        };
      }
    } catch {
      /* fallback silencioso */
    }
    return { plan: "free", planExpiresAtIso: null };
  },
);

/**
 * Lee el flag onboarded_at para saber si mostrar el modal welcome.
 */
export const getUserOnboarded = cache(async (userId: string): Promise<boolean> => {
  try {
    const rows = await db.execute<{ onboarded_at: string | null }>(sql`
      SELECT onboarded_at FROM auth.users WHERE id = ${userId}::uuid LIMIT 1
    `);
    return rows[0]?.onboarded_at != null;
  } catch {
    return true; // fail-open: no molestar con modal si el lookup falla
  }
});
