/**
 * POST /api/v1/admin/llm-providers/[id]/test
 *
 * Prueba de conexion con el provider (auth + reachability). Persiste
 * el resultado en last_test_at / last_test_ok / last_test_error para
 * display en la UI admin.
 *
 * Tambien soporta test de una config aun no guardada — util para
 * validar la api key en el modal "Agregar provider" antes de save.
 * En ese caso, el body incluye providerType/model/apiKey/baseUrl y
 * se instancia un provider ad-hoc sin persistir.
 */

import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { requireSession } from "@/lib/auth-helpers";
import { handleRoute, NotFoundError, ValidationError } from "@/lib/domains/shared";
import {
  getProviderById,
  recordTestResult,
  instantiate,
  type ProviderType,
} from "@/lib/domains/llm-vault";
import { getDecryptedApiKey } from "@/lib/domains/llm-vault/queries";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function POST(req: NextRequest, ctx: { params: Params }) {
  return handleRoute(async () => {
    const session = await requireSession();
    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const { id } = await ctx.params;

    // Modo A: test de un provider ya persistido (id != "new")
    // Modo B: test ad-hoc del modal (id == "new", body incluye config completa)
    let providerInstance;

    if (id === "new") {
      const body = (await req.json()) as {
        providerType?: ProviderType;
        model?: string;
        apiKey?: string;
        baseUrl?: string;
      };
      if (!body.providerType || !body.model) {
        throw new ValidationError("providerType y model requeridos para test ad-hoc");
      }
      providerInstance = instantiate({
        id: "new",
        providerType: body.providerType,
        model: body.model,
        apiKey: body.apiKey ?? null,
        baseUrl: body.baseUrl ?? null,
        maxTokens: 5,
        temperature: 0,
      });
    } else {
      const existing = await getProviderById(id);
      if (!existing) throw new NotFoundError("Provider no encontrado", { id });
      const apiKey = await getDecryptedApiKey(id);
      providerInstance = instantiate({
        id,
        providerType: existing.providerType,
        model: existing.model,
        apiKey,
        baseUrl: existing.baseUrl,
        maxTokens: 5,
        temperature: 0,
      });
    }

    const result = await providerInstance.testConnection();

    // Persistir resultado solo si es un provider ya guardado
    if (id !== "new") {
      await recordTestResult(
        id,
        result.ok,
        result.ok ? null : result.error,
        { email: session.email ?? "unknown", ip },
      );
    }

    return result;
  });
}
