import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { type AiProviderId, getProvider, updateProvider } from "@/lib/domains/ai-providers";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const providerSchema = z.enum(["claude", "openai", "ollama", "gemini"]);

const patchBody = z.object({
  apiKey: z.string().max(1024).nullable().optional(),
  baseUrl: z.string().max(500).nullable().optional(),
  modelDefault: z.string().max(120).nullable().optional(),
  enabled: z.boolean().optional(),
  notas: z.string().max(500).nullable().optional(),
});

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session.user.id;
}

type Ctx = { params: Promise<{ provider: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    await requireUserId();
    const { provider } = await ctx.params;
    const parsed = providerSchema.safeParse(provider);
    if (!parsed.success) throw new ValidationError("Provider invalido", { provider });
    return getProvider(parsed.data as AiProviderId);
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const userId = await requireUserId();
    const { provider } = await ctx.params;
    const parsedProvider = providerSchema.safeParse(provider);
    if (!parsedProvider.success)
      throw new ValidationError("Provider invalido", { provider });
    const json = await req.json();
    const parsed = patchBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    return updateProvider(parsedProvider.data as AiProviderId, parsed.data, userId);
  });
}
