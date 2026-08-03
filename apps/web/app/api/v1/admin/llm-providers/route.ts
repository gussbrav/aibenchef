/**
 * GET  /api/v1/admin/llm-providers        - lista providers (sin api key)
 * POST /api/v1/admin/llm-providers        - crea provider nuevo
 *
 * Ambos requieren sesion admin. La api_key en el body del POST se cifra
 * al guardar y nunca se devuelve.
 */

import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { requireSession } from "@/lib/auth-helpers";
import { handleRoute, ValidationError } from "@/lib/domains/shared";
import { createProvider, listProviders, type LlmProviderInput } from "@/lib/domains/llm-vault";

export const dynamic = "force-dynamic";

const VALID_TYPES = ["anthropic", "openai", "ollama", "openai_compatible", "google"] as const;

export async function GET() {
  return handleRoute(async () => {
    await requireSession();
    const providers = await listProviders();
    return { providers };
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const session = await requireSession();
    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

    const body = (await req.json()) as Partial<LlmProviderInput>;
    validateInput(body);

    const created = await createProvider(body as LlmProviderInput, {
      email: session.email ?? "unknown",
      ip,
    });

    // NUNCA devolver la api_key. El created ya viene de la vista sanitizada.
    return { provider: created };
  });
}

function validateInput(body: Partial<LlmProviderInput>): void {
  if (!body.providerType || !VALID_TYPES.includes(body.providerType)) {
    throw new ValidationError(
      `providerType invalido. Valores validos: ${VALID_TYPES.join(", ")}`,
    );
  }
  if (!body.displayName || body.displayName.length < 2) {
    throw new ValidationError("displayName requerido (>=2 chars)");
  }
  if (!body.model || body.model.length < 2) {
    throw new ValidationError("model requerido");
  }
  // API key: opcional para Ollama sin auth; requerida para el resto
  if (body.providerType !== "ollama" && !body.apiKey) {
    throw new ValidationError(`API key requerida para provider ${body.providerType}`);
  }
  if (body.temperature != null && (body.temperature < 0 || body.temperature > 1)) {
    throw new ValidationError("temperature debe estar entre 0 y 1");
  }
  if (body.maxTokensOutput != null && (body.maxTokensOutput < 50 || body.maxTokensOutput > 4000)) {
    throw new ValidationError("maxTokensOutput debe estar entre 50 y 4000");
  }
}
