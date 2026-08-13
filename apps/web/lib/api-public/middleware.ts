import "server-only";

/**
 * Middleware compartido para todas las rutas /api/public/v1/*.
 *
 * Uso:
 *   export async function GET(req: NextRequest) {
 *     return withApiPublic(req, async (ctx) => {
 *       // ctx.userId, ctx.plan, ctx.apiKeyId disponibles
 *       return { hello: "world" };
 *     });
 *   }
 *
 * Responsabilidades:
 *   1. Extraer el token del header Authorization o X-API-Key
 *   2. Verificarlo contra la DB (hash constant-time)
 *   3. Chequear rate limit para el plan del user
 *   4. Registrar el uso (bump last_used_at + counter)
 *   5. Invocar el handler con el contexto autenticado
 *   6. Serializar la respuesta como JSON con headers estandar
 *
 * Errores devueltos:
 *   401 — token ausente / invalido / revocado
 *   402 — plan sin apiAccess
 *   429 — rate limit excedido
 *   500 — error interno
 *
 * NO usa cookies. NO comparte estado con Better Auth. Es un canal
 * completamente aparte del auth de la webapp.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { PLAN_LIMITS, type UserPlan } from "@/lib/plans";
import {
  verifyApiKey,
  recordApiKeyUsage,
  countApiKeyRequestsLastMinute,
  rateLimitForPlan,
} from "@/lib/domains/api-keys";
import { logger } from "@/lib/domains/shared";

const log = logger.child("api-public");

export type ApiPublicContext = {
  apiKeyId: string;
  userId: string;
  plan: UserPlan;
  role: string;
};

function extractToken(req: NextRequest): string | null {
  // Preferimos Authorization: Bearer, alternativa X-API-Key para clientes
  // que no puedan setear Authorization (algunos proxies lo strippean).
  const auth = req.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  const xkey = req.headers.get("x-api-key");
  if (xkey) return xkey.trim();
  return null;
}

function errorJson(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(extra ?? {}),
      },
    },
    {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}

export async function withApiPublic<T>(
  req: NextRequest,
  handler: (ctx: ApiPublicContext) => Promise<T>,
): Promise<NextResponse> {
  const token = extractToken(req);
  if (!token) {
    return errorJson(
      401,
      "missing_token",
      "Falta el header Authorization: Bearer <api_key>",
    );
  }

  let key;
  try {
    key = await verifyApiKey(token);
  } catch (err) {
    log.error("verifyApiKey failed", { err: String(err) });
    return errorJson(500, "internal_error", "Error verificando la API key");
  }
  if (!key) {
    return errorJson(401, "invalid_token", "API key invalida o revocada");
  }

  const plan = key.plan as UserPlan;
  // Admin bypass del apiAccess check (admins pueden llamar la API aunque
  // su plan tecnico sea 'free', son casos internos de debugging).
  const isAdmin = key.role === "admin";
  if (!isAdmin && !PLAN_LIMITS[plan]?.apiAccess) {
    return errorJson(
      402,
      "plan_no_api",
      "Tu plan no incluye acceso a la API publica. Actualiza a Academico ($9/mes) o Pro ($149/mes).",
      { plan },
    );
  }

  // Rate limit — el count es de los ultimos 60s rolling.
  const limit = rateLimitForPlan(plan);
  let used;
  try {
    used = await countApiKeyRequestsLastMinute(key.apiKeyId);
  } catch (err) {
    log.error("countApiKeyRequestsLastMinute failed", { err: String(err) });
    // Fail-open ante error de DB — mejor servir el request que 500.
    used = 0;
  }
  if (used >= limit) {
    return errorJson(
      429,
      "rate_limit_exceeded",
      `Rate limit de ${limit} req/min excedido para tu plan (${plan}). Espera un momento.`,
      { plan, limit, used },
    );
  }

  // Registrar el uso ANTES de correr el handler (para que un handler
  // lento no permita bypass del cap sirviendo mas requests en paralelo).
  try {
    await recordApiKeyUsage(key.apiKeyId);
  } catch (err) {
    log.error("recordApiKeyUsage failed", { err: String(err) });
    // Fail-open — el request sigue.
  }

  try {
    const data = await handler({
      apiKeyId: key.apiKeyId,
      userId: key.userId,
      plan,
      role: key.role,
    });
    return NextResponse.json(
      { data },
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-ratelimit-limit": String(limit),
          "x-ratelimit-remaining": String(Math.max(0, limit - used - 1)),
        },
      },
    );
  } catch (err) {
    log.error("handler error", { err: String(err) });
    if (err instanceof Error && "status" in err) {
      const status = (err as unknown as { status: number }).status ?? 500;
      return errorJson(status, "handler_error", err.message);
    }
    return errorJson(500, "internal_error", "Error procesando la solicitud");
  }
}
