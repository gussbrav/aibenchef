/**
 * POST /api/v1/settings/ai-providers/[provider]/test
 *
 * Hace una llamada de prueba al endpoint del provider configurado, desde el
 * servidor de Aibenchef (no desde el browser). Esto es util porque el
 * hostname interno de Docker (`http://azoramind_ollama:11434`) no resuelve
 * desde la maquina del usuario, solo desde dentro del project en EasyPanel.
 *
 * Respuesta:
 *  - ok: true + detalles (modelos disponibles, tiempo, etc)
 *  - ok: false + mensaje de error humano-readable
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  type AiProviderId,
  getProvider,
  getProviderApiKey,
  getProviderBaseUrl,
} from "@/lib/domains/ai-providers";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const providerSchema = z.enum(["claude", "openai", "ollama", "gemini"]);

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError("Sesion requerida", {});
  return session.user.id;
}

type TestResult = {
  ok: boolean;
  provider: AiProviderId;
  message: string;
  elapsedMs: number;
  models?: string[];
  hint?: string;
};

type Ctx = { params: Promise<{ provider: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  return handleRoute(async (): Promise<TestResult> => {
    await requireUserId();
    const { provider } = await ctx.params;
    const parsed = providerSchema.safeParse(provider);
    if (!parsed.success) throw new ValidationError("Provider invalido", { provider });
    const id = parsed.data as AiProviderId;

    const start = Date.now();
    try {
      const result = await testProvider(id);
      return { ...result, elapsedMs: Date.now() - start };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        provider: id,
        message: msg,
        elapsedMs: Date.now() - start,
        hint: pickHint(id, msg),
      };
    }
  });
}

async function testProvider(id: AiProviderId): Promise<TestResult> {
  const cfg = await getProvider(id);
  if (!cfg.enabled) {
    return {
      ok: false,
      provider: id,
      message: "Provider deshabilitado. Marca 'Habilitar este proveedor' y guarda primero.",
      elapsedMs: 0,
    };
  }

  const apiKey = await getProviderApiKey(id);
  const baseUrl = await getProviderBaseUrl(id);

  if (id === "ollama") {
    const url = (baseUrl || "http://localhost:11434").replace(/\/$/, "") + "/api/tags";
    const r = await fetchWithTimeout(url, { method: "GET" }, 10000);
    if (!r.ok) {
      return {
        ok: false,
        provider: id,
        message: `Ollama respondio HTTP ${r.status}. URL: ${url}`,
        elapsedMs: 0,
      };
    }
    const body = (await r.json()) as { models?: Array<{ name: string }> };
    const models = (body.models ?? []).map((m) => m.name);
    return {
      ok: true,
      provider: id,
      message: `Conexion OK. ${models.length} modelos disponibles.`,
      models,
      elapsedMs: 0,
    };
  }

  if (id === "claude") {
    if (!apiKey) {
      return { ok: false, provider: id, message: "API key requerida para Claude.", elapsedMs: 0 };
    }
    const url = (baseUrl || "https://api.anthropic.com").replace(/\/$/, "") + "/v1/models";
    const r = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      },
      10000,
    );
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return {
        ok: false,
        provider: id,
        message: `Claude respondio HTTP ${r.status}. ${txt.slice(0, 200)}`,
        elapsedMs: 0,
      };
    }
    const body = (await r.json()) as { data?: Array<{ id: string }> };
    const models = (body.data ?? []).map((m) => m.id);
    return {
      ok: true,
      provider: id,
      message: `Conexion OK. ${models.length} modelos disponibles.`,
      models,
      elapsedMs: 0,
    };
  }

  if (id === "openai") {
    if (!apiKey) {
      return { ok: false, provider: id, message: "API key requerida para OpenAI.", elapsedMs: 0 };
    }
    const url = (baseUrl || "https://api.openai.com").replace(/\/$/, "") + "/v1/models";
    const r = await fetchWithTimeout(
      url,
      { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } },
      10000,
    );
    if (!r.ok) {
      return {
        ok: false,
        provider: id,
        message: `OpenAI respondio HTTP ${r.status}. ${r.status === 401 ? "API key invalida." : ""}`,
        elapsedMs: 0,
      };
    }
    const body = (await r.json()) as { data?: Array<{ id: string }> };
    const models = (body.data ?? []).map((m) => m.id).slice(0, 20);
    return {
      ok: true,
      provider: id,
      message: `Conexion OK. ${(body.data ?? []).length} modelos disponibles.`,
      models,
      elapsedMs: 0,
    };
  }

  if (id === "gemini") {
    if (!apiKey) {
      return { ok: false, provider: id, message: "API key requerida para Gemini.", elapsedMs: 0 };
    }
    const url =
      (baseUrl || "https://generativelanguage.googleapis.com").replace(/\/$/, "") +
      `/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const r = await fetchWithTimeout(url, { method: "GET" }, 10000);
    if (!r.ok) {
      return {
        ok: false,
        provider: id,
        message: `Gemini respondio HTTP ${r.status}. ${r.status === 400 ? "API key invalida." : ""}`,
        elapsedMs: 0,
      };
    }
    const body = (await r.json()) as { models?: Array<{ name: string }> };
    const models = (body.models ?? []).map((m) => m.name);
    return {
      ok: true,
      provider: id,
      message: `Conexion OK. ${models.length} modelos disponibles.`,
      models: models.slice(0, 20),
      elapsedMs: 0,
    };
  }

  return { ok: false, provider: id, message: "Provider no soportado", elapsedMs: 0 };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function pickHint(id: AiProviderId, msg: string): string | undefined {
  const m = msg.toLowerCase();
  if (id === "ollama") {
    if (m.includes("getaddrinfo") || m.includes("enotfound") || m.includes("resolve")) {
      return "El hostname no resuelve desde el servidor de Aibenchef. Si Ollama esta en otro EasyPanel project, usa la IP publica del Hetzner en vez del nombre interno.";
    }
    if (m.includes("econnrefused") || m.includes("connection refused")) {
      return "El puerto esta cerrado o Ollama no esta corriendo. Verifica con 'docker ps' en el server.";
    }
    if (m.includes("abort") || m.includes("timeout")) {
      return "Timeout de 10s. La URL es alcanzable pero Ollama no responde. Verifica que el servicio este levantado.";
    }
  }
  if (m.includes("401") || m.includes("unauthor")) return "API key invalida o expirada.";
  if (m.includes("403")) return "API key sin permisos para listar modelos.";
  return undefined;
}
