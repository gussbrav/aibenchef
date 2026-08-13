#!/usr/bin/env node
/**
 * @aibenchef/mcp — Model Context Protocol server para consumir la data
 * publica del sistema financiero peruano desde Claude Desktop / Cursor /
 * cualquier cliente MCP.
 *
 * Config via env:
 *   AIBENCHEF_API_KEY   — obligatorio, generar en https://aibenchef.azoramind.com/dashboard/settings
 *   AIBENCHEF_BASE_URL  — opcional, default https://aibenchef.azoramind.com/api/public/v1
 *
 * Transporte: stdio (para Claude Desktop y la mayoria de clientes MCP).
 *
 * Ejemplo de configuracion en claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "aibenchef": {
 *         "command": "npx",
 *         "args": ["-y", "@aibenchef/mcp"],
 *         "env": { "AIBENCHEF_API_KEY": "aibchf_..." }
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const API_KEY = process.env.AIBENCHEF_API_KEY;
const BASE_URL =
  process.env.AIBENCHEF_BASE_URL ??
  "https://aibenchef.azoramind.com/api/public/v1";

if (!API_KEY) {
  console.error(
    "❌ AIBENCHEF_API_KEY no seteada. Generala en https://aibenchef.azoramind.com/dashboard/settings (tab API keys) y agregala al env.",
  );
  process.exit(1);
}

// ============================================================================
// Cliente HTTP minimalista
// ============================================================================

async function apiGet(path: string, params?: Record<string, string | number | undefined>): Promise<unknown> {
  const url = new URL(BASE_URL + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      accept: "application/json",
    },
  });
  const json = (await res.json().catch(() => null)) as
    | { data?: unknown; error?: { code: string; message: string } }
    | null;
  if (!res.ok) {
    const err = json?.error;
    throw new Error(
      err ? `${err.code}: ${err.message}` : `HTTP ${res.status}`,
    );
  }
  return json?.data;
}

// ============================================================================
// Tools schema
// ============================================================================

const tools = [
  {
    name: "list_entidades",
    description:
      "Lista el catálogo de entidades reguladas del sistema financiero peruano (bancos, financieras, cajas municipales, cajas rurales, empresas de créditos). Opcional filtrar por tipo.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tipo: {
          type: "string" as const,
          enum: ["BANCOS", "FINANCIERAS", "CMAC", "CRAC", "EDPYMES"],
          description: "Filtro por tipo regulatorio",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_periodos_publicados",
    description:
      "Lista los periodos YYYYMM con data publicada (más reciente primero). Útil para saber el último cierre disponible antes de pedir data específica.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ultimos_n: {
          type: "integer" as const,
          minimum: 1,
          maximum: 240,
          description: "Cuántos periodos devolver. Default 60 (5 años).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_eeff",
    description:
      "Obtiene el Balance General (estados financieros) de una entidad para un periodo específico. Devuelve las cuentas del plan contable con sus saldos.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entidad: {
          type: "string" as const,
          description:
            "Nombre canónico de la entidad (ej: 'Banco de Crédito del Perú', 'Mibanco', 'CMAC Arequipa').",
        },
        periodo: {
          type: "integer" as const,
          description: "Periodo en formato YYYYMM (ej: 202606 = Jun 2026).",
        },
        moneda: {
          type: "string" as const,
          enum: ["TOTAL", "MN", "ME"],
          description: "TOTAL (default), MN (soles), ME (dólares).",
        },
      },
      required: ["entidad", "periodo"],
      additionalProperties: false,
    },
  },
  {
    name: "get_kpis",
    description:
      "Obtiene la serie temporal de ratios anualizados (TTM) de una entidad: ROA, ROE, Mora, Cobertura CAR, Eficiencia, Apalancamiento, Cartera Bruta, Depósitos, etc. Ideal para gráficas de evolución.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entidad: { type: "string" as const },
        desde: {
          type: "integer" as const,
          description: "Periodo desde YYYYMM (inclusivo). Default: sin límite.",
        },
        hasta: {
          type: "integer" as const,
          description: "Periodo hasta YYYYMM (inclusivo). Default: sin límite.",
        },
        moneda: {
          type: "string" as const,
          enum: ["TOTAL", "MN", "ME"],
        },
      },
      required: ["entidad"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_benchmark",
    description:
      "Comparativa lado-a-lado de ratios para varias entidades en el mismo periodo. Ideal para peer group analysis (ej: BCP vs BBVA vs Interbank vs Scotiabank).",
    inputSchema: {
      type: "object" as const,
      properties: {
        entidades: {
          type: "array" as const,
          items: { type: "string" as const },
          description:
            "Lista de nombres canónicos de entidades (max 20). El plan comercial puede truncar a menos.",
          minItems: 1,
          maxItems: 20,
        },
        periodo: {
          type: "integer" as const,
          description: "Periodo YYYYMM. Default: último publicado.",
        },
      },
      required: ["entidades"],
      additionalProperties: false,
    },
  },
];

// Schemas Zod para validar args
const listEntidadesArgs = z.object({
  tipo: z.enum(["BANCOS", "FINANCIERAS", "CMAC", "CRAC", "EDPYMES"]).optional(),
});
const listPeriodosArgs = z.object({
  ultimos_n: z.number().int().min(1).max(240).optional(),
});
const getEeffArgs = z.object({
  entidad: z.string().min(1),
  periodo: z.number().int().min(200001),
  moneda: z.enum(["TOTAL", "MN", "ME"]).optional(),
});
const getKpisArgs = z.object({
  entidad: z.string().min(1),
  desde: z.number().int().min(200001).optional(),
  hasta: z.number().int().min(200001).optional(),
  moneda: z.enum(["TOTAL", "MN", "ME"]).optional(),
});
const compareBenchmarkArgs = z.object({
  entidades: z.array(z.string().min(1)).min(1).max(20),
  periodo: z.number().int().min(200001).optional(),
});

// ============================================================================
// Server setup
// ============================================================================

const server = new Server(
  {
    name: "aibenchef",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = rawArgs ?? {};

  try {
    switch (name) {
      case "list_entidades": {
        const p = listEntidadesArgs.parse(args);
        const data = await apiGet("/entidades", { tipo: p.tipo });
        return textResult(JSON.stringify(data, null, 2));
      }
      case "list_periodos_publicados": {
        const p = listPeriodosArgs.parse(args);
        const data = await apiGet("/periodos", { ultimosN: p.ultimos_n });
        return textResult(JSON.stringify(data, null, 2));
      }
      case "get_eeff": {
        const p = getEeffArgs.parse(args);
        const data = await apiGet(
          `/entidades/${encodeURIComponent(p.entidad)}/eeff`,
          { periodo: p.periodo, moneda: p.moneda },
        );
        return textResult(JSON.stringify(data, null, 2));
      }
      case "get_kpis": {
        const p = getKpisArgs.parse(args);
        const data = await apiGet(
          `/entidades/${encodeURIComponent(p.entidad)}/kpis`,
          { desde: p.desde, hasta: p.hasta, moneda: p.moneda },
        );
        return textResult(JSON.stringify(data, null, 2));
      }
      case "compare_benchmark": {
        const p = compareBenchmarkArgs.parse(args);
        const data = await apiGet("/benchmarks", {
          entidades: p.entidades.join(","),
          periodo: p.periodo,
        });
        return textResult(JSON.stringify(data, null, 2));
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [
        { type: "text" as const, text: `Error: ${msg}` },
      ],
      isError: true,
    };
  }
});

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

// ============================================================================
// Boot
// ============================================================================

const transport = new StdioServerTransport();
await server.connect(transport);

// Signal ready via stderr (stdout es para el protocolo MCP, no polluir)
console.error("[aibenchef-mcp] listo. Escuchando por stdio.");
