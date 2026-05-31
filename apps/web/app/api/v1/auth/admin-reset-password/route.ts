/**
 * POST /api/v1/auth/admin-reset-password { token, newPassword }
 * Endpoint PUBLICO (sin sesion). Consume un token emitido por un admin.
 * GET /api/v1/auth/admin-reset-password?token=... -> preview.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  consumeResetToken,
  previewResetToken,
} from "@/lib/domains/password-reset";
import { handleRoute, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(32).max(200),
  newPassword: z.string().min(8).max(256),
});

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? "";
    return previewResetToken(token);
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    return consumeResetToken(parsed.data.token, parsed.data.newPassword);
  });
}
