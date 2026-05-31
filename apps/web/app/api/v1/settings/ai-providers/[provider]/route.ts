import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  extractAuditContext,
  recordAuditEvent,
} from "@/lib/domains/governance";
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

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session;
}

type Ctx = { params: Promise<{ provider: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    await requireSession();
    const { provider } = await ctx.params;
    const parsed = providerSchema.safeParse(provider);
    if (!parsed.success) throw new ValidationError("Provider invalido", { provider });
    return getProvider(parsed.data as AiProviderId);
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handleRoute(async () => {
    const hdrs = await headers();
    const session = await requireSession();
    const userId = session.user.id;
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
    const updated = await updateProvider(
      parsedProvider.data as AiProviderId,
      parsed.data,
      userId,
    );

    // Audit en gov.audit_log (dual-write con app.ai_providers_audit).
    // Sensible: cambio en credenciales/url de LLM provider.
    const ctxAudit = extractAuditContext(hdrs, userId, session.user.email);
    const cambios: string[] = [];
    if (parsed.data.apiKey !== undefined) cambios.push("apiKey");
    if (parsed.data.baseUrl !== undefined) cambios.push("baseUrl");
    if (parsed.data.modelDefault !== undefined) cambios.push("modelDefault");
    if (parsed.data.enabled !== undefined) cambios.push("enabled");
    if (parsed.data.notas !== undefined) cambios.push("notas");
    await recordAuditEvent({
      ...ctxAudit,
      category: "ai_providers",
      action: "provider_update",
      severity: cambios.includes("apiKey") ? "warn" : "info",
      resource: `provider:${parsedProvider.data}`,
      metadata: { campos: cambios },
    });

    return updated;
  });
}
