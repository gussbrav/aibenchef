/**
 * /dashboard/admin/llm-settings — Vault de credenciales LLM.
 *
 * Gestiona los proveedores AI (Claude, OpenAI, Ollama) que alimentan
 * los insights del /dashboard/informe. API keys se cifran en DB con
 * master key vault (env LLM_VAULT_MASTER_KEY).
 *
 * SEGURIDAD:
 * - Solo admins con sesion activa acceden a esta ruta
 * - Las api keys NUNCA se envian al browser — solo el hint (ultimos 4 chars)
 * - El campo "API key" del formulario solo se transmite del browser al
 *   server via POST HTTPS y se cifra inmediatamente
 */

import type { Metadata } from "next";
import { KeyRound } from "lucide-react";

import { listProviders } from "@/lib/domains/llm-vault";
import { LlmProvidersClient } from "./llm-providers-client";

export const metadata: Metadata = {
  title: "LLM Settings",
};

export const dynamic = "force-dynamic";

export default async function LlmSettingsPage() {
  const providers = await listProviders();

  return (
    <div className="space-y-8 px-4 lg:px-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <KeyRound className="w-6 h-6 text-slate-600" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            LLM Settings
          </h1>
        </div>
        <p className="text-slate-600 text-sm max-w-3xl">
          Proveedores AI que alimentan los insights automáticos del benchmark.
          Las API keys se guardan cifradas con AES-256 (master key en variable
          de entorno del servidor). Podés tener un proveedor por defecto global
          y overrides específicos por cliente.
        </p>
      </header>

      <LlmProvidersClient initialProviders={providers} />
    </div>
  );
}
