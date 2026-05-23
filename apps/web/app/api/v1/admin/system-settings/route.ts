/**
 * GET /api/v1/admin/system-settings — lista todas las settings (secrets masked)
 * PUT /api/v1/admin/system-settings — actualiza una setting por key
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  listSystemSettings,
  updateSystemSetting,
} from "@/lib/domains/system-settings";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session.user.id;
}

export async function GET() {
  return handleRoute(async () => {
    const userId = await requireUserId();
    return listSystemSettings(userId);
  });
}

const putBody = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(2000).nullable(),
});

export async function PUT(req: NextRequest) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const json = await req.json();
    const parsed = putBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    return updateSystemSetting(userId, parsed.data.key, parsed.data.value);
  });
}
