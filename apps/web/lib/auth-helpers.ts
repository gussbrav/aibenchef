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

import { headers } from "next/headers";

import { auth } from "@/lib/auth";

import { UnauthorizedError, ForbiddenError } from "@/lib/domains/shared/errors";

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
