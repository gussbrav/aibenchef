/**
 * POST /api/v1/auth/request-access — endpoint PUBLICO (sin sesion).
 * Recibe una solicitud de acceso al beta y la guarda en app.access_requests.
 *
 * Anti-spam:
 *  - Honeypot field "website" (hidden, debe quedar vacio).
 *  - Rate limit por ip_hash via app.access_request_rate (max 3/hora).
 *  - Validacion zod estricta.
 *  - No expone si el email ya existia (privacy — anti-enumeracion).
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  createAccessRequest,
  hashIp,
} from "@/lib/domains/access-requests";
import { handleRoute, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email().max(254),
  nombre: z.string().min(2).max(120),
  empresa: z.string().min(2).max(120),
  rol: z.string().max(120).optional().nullable(),
  tamanoEquipo: z.enum(["solo", "2-10", "11-50", "51-200", "200+"]).optional().nullable(),
  casoUso: z.string().max(1500).optional().nullable(),
  source: z.string().max(40).optional(),
  // Honeypot — debe llegar vacio. Los bots completan todos los campos visibles.
  website: z.string().optional(),
});

function extractIp(req: NextRequest): string | null {
  // EasyPanel / Traefik / Cloudflare pasan la IP real en estos headers.
  const candidates = [
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-real-ip"),
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  ];
  for (const c of candidates) {
    if (c && c !== "127.0.0.1" && c !== "::1") return c;
  }
  return null;
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const json = await req.json().catch(() => null);
    if (!json) throw new ValidationError("Body invalido (JSON parse error)", {});
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Algunos campos no son validos", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    const ip = extractIp(req);
    const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;
    const referer = req.headers.get("referer")?.slice(0, 500) ?? null;

    return createAccessRequest({
      email: parsed.data.email,
      nombre: parsed.data.nombre,
      empresa: parsed.data.empresa,
      rol: parsed.data.rol ?? null,
      tamanoEquipo: parsed.data.tamanoEquipo ?? null,
      casoUso: parsed.data.casoUso ?? null,
      source: parsed.data.source ?? "signup_page",
      ipHash: ip ? hashIp(ip) : null,
      userAgent,
      referer,
      honeypot: parsed.data.website ?? null,
    });
  });
}
