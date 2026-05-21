import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { DrizzleWaitlistRepository, makeJoinWaitlist } from "@/lib/domains/waitlist";
import { handleRoute, ValidationError, logger } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const log = logger.child("api.waitlist");

/**
 * Resuelve el origin publico real cuando la app corre detras de un proxy
 * reverso (EasyPanel/Traefik). req.url devuelve el hostname interno del
 * contenedor (http://0.0.0.0:3000/...) lo que rompe los redirects.
 *
 * Prioridad:
 *  1. NEXT_PUBLIC_APP_URL (configurado en build/runtime).
 *  2. x-forwarded-proto + x-forwarded-host (forwarded por el reverse proxy).
 *  3. host header + https asumido.
 *  4. req.url.origin como ultimo recurso.
 */
function resolvePublicOrigin(req: NextRequest, h: Headers): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");

  const fwdHost = h.get("x-forwarded-host");
  const fwdProto = h.get("x-forwarded-proto");
  if (fwdHost) {
    return `${fwdProto ?? "https"}://${fwdHost}`;
  }

  const host = h.get("host");
  if (host && !host.startsWith("0.0.0.0") && !host.startsWith("127.0.0.1")) {
    return `https://${host}`;
  }

  return new URL(req.url).origin;
}

const inputSchema = z.object({
  email: z.string().min(3).max(254),
  organization: z.string().max(200).optional(),
  source: z.string().max(50).optional(),
  utm_source: z.string().max(100).optional(),
  utm_medium: z.string().max(100).optional(),
  utm_campaign: z.string().max(100).optional(),
});

function extractFormOrJson(req: NextRequest): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return req.json() as Promise<Record<string, unknown>>;
  }
  return req.formData().then((fd) => {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) obj[k] = v;
    return obj;
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const raw = await extractFormOrJson(req);
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError("Datos invalidos", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const headersList = await headers();
    const joinWaitlist = makeJoinWaitlist({ repo: new DrizzleWaitlistRepository() });

    const result = await joinWaitlist({
      email: parsed.data.email,
      organization: parsed.data.organization,
      source: parsed.data.source ?? "landing",
      referrer: headersList.get("referer") ?? undefined,
      userAgent: headersList.get("user-agent") ?? undefined,
      ipAddress: (headersList.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || undefined,
      utm: {
        source: parsed.data.utm_source,
        medium: parsed.data.utm_medium,
        campaign: parsed.data.utm_campaign,
      },
    });

    // Si la request es form (HTML form post), redirigir a thanks.
    // Si la request es JSON (fetch API), devolver JSON.
    const accept = req.headers.get("accept") ?? "";
    if (!accept.includes("application/json")) {
      const origin = resolvePublicOrigin(req, headersList);
      return NextResponse.redirect(`${origin}/waitlist/ok`, 303);
    }

    return {
      ok: true,
      alreadyExisted: result.alreadyExisted,
    };
  });
}
