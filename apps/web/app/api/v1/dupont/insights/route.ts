/**
 * POST /api/v1/dupont/insights
 *
 * Genera narrativa auto por IA (Claude) para las 4 secciones del Analisis
 * DuPont en UNA sola llamada al LLM (mas rapido y menos tokens que 4 x 1).
 *
 * Body: { data: DupontData }  (la matriz completa que el cliente ya tiene)
 * Response: {
 *   narrativa: {
 *     roe: string[],   // 2-4 bullets
 *     roa: string[],
 *     mon: string[],
 *     mfb: string[]
 *   },
 *   model: string,     // proveedor usado para observabilidad
 *   cached: boolean    // hit del cache in-memory
 * }
 *
 * Auth: session required (no admin — cualquier usuario logueado).
 * Cache in-memory por hash del input (TTL 30 min) para no pagar tokens
 * en cada refresh de la vista.
 *
 * Fallback: si el LLM falla o no hay proveedor configurado, devuelve
 * `{ narrativa: null }` y el cliente cae a la narrativa deterministica.
 */

import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/infrastructure/db";
import {
  handleRoute,
  UnauthorizedError,
  ValidationError,
} from "@/lib/domains/shared";
import { getProviderForCliente, LlmProviderError } from "@/lib/domains/llm-vault";
import type { DupontData } from "@/lib/domains/dupont";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Insights = {
  roe: string[];
  roa: string[];
  mon: string[];
  mfb: string[];
};

// Cache CROSS-USER CROSS-DEPLOY en Postgres (app.dupont_insights_cache).
// Reemplaza el cache in-memory previo. Beneficios:
//   - Compartido entre todos los usuarios: los defaults (peer group estandar)
//     se generan 1 vez para toda la organizacion.
//   - Sobrevive deploys: al rebuild no se pierde nada.
//   - Sobrevive escalamiento horizontal.
//
// Micro-cache in-memory de 60s para dedupear requests concurrentes al mismo
// hash (evita race condition donde 2 users piden lo mismo simultaneamente
// y ambos disparan Claude). El first-in gana, el resto espera al DB.
type InMemHit = { at: number; insights: Insights; model: string | null };
const INFLIGHT = new Map<string, Promise<InMemHit | null>>();
const MICROCACHE = new Map<string, InMemHit>();
const MICROCACHE_TTL_MS = 60 * 1000;
const MICROCACHE_MAX = 50;

function pruneMicrocache() {
  if (MICROCACHE.size <= MICROCACHE_MAX) return;
  const now = Date.now();
  for (const [k, v] of MICROCACHE) {
    if (now - v.at > MICROCACHE_TTL_MS) MICROCACHE.delete(k);
  }
}

function hashInput(data: DupontData): string {
  const h = createHash("sha256");
  h.update(JSON.stringify({
    ents: data.entidades.map((e) => e.nombCorreg),
    pers: data.periodos.map((p) => p.codigo),
    rows: data.filas.map((r) => ({
      e: r.entidad,
      p: r.periodo,
      roe: r.roePct?.toFixed(2),
      roa: r.roaPct?.toFixed(2),
      apa: r.apalancamiento?.toFixed(2),
      mon: r.margenOpPct?.toFixed(2),
      oth: r.otrosIngPct?.toFixed(2),
      imp: r.impuestosPct?.toFixed(2),
      mfb: r.mfbPct?.toFixed(2),
      isf: r.isfnPct?.toFixed(2),
      per: r.personalPct?.toFixed(2),
      gen: r.generalesPct?.toFixed(2),
      pro: r.provisionesPct?.toFixed(2),
      ica: r.ingCarteraPct?.toFixed(2),
      iin: r.ingInversionPct?.toFixed(2),
      gfi: r.gastosFinPct?.toFixed(2),
    })),
  }));
  return h.digest("hex").slice(0, 32);
}

// Prompt system: define tono, formato de output y reglas estrictas.
// Reforzamos el castellano peruano (tuteo) y NO voseo argentino porque
// Claude tiende al voseo por default. Regla de oro del proyecto — ver
// feedback_castellano_peruano en el memory system.
const SYSTEM_PROMPT = `Eres un analista financiero senior del sistema microfinanciero peruano regulado por la SBS. Vas a leer un análisis DuPont (descomposición del ROE) de N entidades × M periodos y generar insights punchy y accionables para cada uno de los 4 niveles del árbol.

REGLAS ESTRICTAS DE OUTPUT:
1. Devuelve SOLO JSON válido con exactamente esta estructura:
   {"roe":["...","..."],"roa":["...","..."],"mon":["...","..."],"mfb":["...","..."]}
2. Cada nivel tiene entre 2 y 4 insights (arrays de strings).
3. Cada insight es UNA oración corta (máximo 22 palabras).
4. Castellano peruano estricto: tuteo (tú puedes, tienes, muestra). NUNCA voseo argentino (vos podés, tenés, mostrá) — está prohibido.
5. Datos concretos: siempre nombra entidades reales + valores exactos con símbolo (ej "27.47%", "8.34×").
6. Prioriza CONTRASTE y ACCIÓN: quién lidera vs quién queda atrás, tendencias, spreads amplios, palancas críticas.
7. Sin obviedades ("todas las entidades tienen ROE"). Cada bullet debe aportar señal analítica.
8. Sin markdown, sin emojis, sin negritas — texto plano dentro del JSON.
9. Contexto SBS: interpreta signos DuPont estándar (gastos negativos, ingresos positivos, MON = MFB + ISFN − gastos).
10. Si un valor es null o falta data para una entidad, no la menciones en ese bullet.

CONTEXTO DE LOS 4 NIVELES:
- ROE: rentabilidad sobre patrimonio. ROE = ROA × Apalancamiento.
- ROA: rentabilidad sobre activos. ROA = Margen Op Neto + Otros Ingresos + Impuestos (todos % activo prom).
- MON: margen operativo neto. MON = MFB + ISF Netos − Personal − Generales − Provisiones.
- MFB: margen financiero bruto. MFB = Ing Cartera + Ing Inversión − Gastos Financieros.`;

function buildUserPrompt(data: DupontData): string {
  const entidades = data.entidades.map((e) => e.nombCorreg).join(", ");
  const periodos = data.periodos.map((p) => p.label).join(", ");
  const tabla = data.filas.map((r) => ({
    entidad: r.entidad,
    periodo: data.periodos.find((p) => p.codigo === r.periodo)?.label ?? String(r.periodo),
    ROE: r.roePct?.toFixed(2) ?? null,
    ROA: r.roaPct?.toFixed(2) ?? null,
    Apalancamiento: r.apalancamiento?.toFixed(2) ?? null,
    MargenOpNeto: r.margenOpPct?.toFixed(2) ?? null,
    OtrosIngNetos: r.otrosIngPct?.toFixed(2) ?? null,
    Impuestos: r.impuestosPct?.toFixed(2) ?? null,
    MFB: r.mfbPct?.toFixed(2) ?? null,
    ISFN: r.isfnPct?.toFixed(2) ?? null,
    Personal: r.personalPct?.toFixed(2) ?? null,
    Generales: r.generalesPct?.toFixed(2) ?? null,
    Provisiones: r.provisionesPct?.toFixed(2) ?? null,
    IngCartera: r.ingCarteraPct?.toFixed(2) ?? null,
    IngInversion: r.ingInversionPct?.toFixed(2) ?? null,
    GastosFinancieros: r.gastosFinPct?.toFixed(2) ?? null,
  }));

  return `Entidades analizadas: ${entidades}
Periodos: ${periodos}

DATOS (todos los ratios en % sobre activo promedio 12M, excepto ROE que es sobre patrimonio y Apalancamiento que es adimensional):
${JSON.stringify(tabla, null, 2)}

Genera el JSON con los 4 arrays de insights. Recuerda: castellano peruano (tú, tienes, muestra), sin voseo argentino.`;
}

function parseInsights(text: string): Insights | null {
  // Extraer el primer bloque JSON valido del output (el LLM a veces
  // wrappea con \`\`\`json ... \`\`\` aunque le pidamos no).
  const trimmed = text.trim();
  let jsonStr = trimmed;
  const fenceMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) jsonStr = fenceMatch[1]!;
  else {
    const braceStart = trimmed.indexOf("{");
    const braceEnd = trimmed.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      jsonStr = trimmed.slice(braceStart, braceEnd + 1);
    }
  }
  try {
    const obj = JSON.parse(jsonStr) as Record<string, unknown>;
    const ok = (k: string): string[] => {
      const v = obj[k];
      if (!Array.isArray(v)) return [];
      return v.filter((x): x is string => typeof x === "string" && x.length > 0);
    };
    const insights = { roe: ok("roe"), roa: ok("roa"), mon: ok("mon"), mfb: ok("mfb") };
    // Sanity: al menos 1 nivel con >=1 insight, sino consideramos parseo fallido
    const total = insights.roe.length + insights.roa.length + insights.mon.length + insights.mfb.length;
    if (total === 0) return null;
    return insights;
  } catch {
    return null;
  }
}

// Check DB cache: si existe, incrementa hit_count y devuelve. Cross-user
// cross-deploy cross-container — costos LLM se comparten entre todos.
async function checkDbCache(key: string): Promise<InMemHit | null> {
  try {
    const rows = await db.execute<{ insights: Insights; model: string | null }>(
      sql`SELECT insights, model FROM app.dupont_insights_cache WHERE input_hash = ${key} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return null;
    // Touch en background — no bloquea la respuesta
    db.execute(sql`SELECT app.dupont_insights_touch(${key})`).catch(() => {});
    return { at: Date.now(), insights: row.insights, model: row.model };
  } catch {
    return null;
  }
}

async function saveDbCache(
  key: string,
  insights: Insights,
  model: string,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO app.dupont_insights_cache (input_hash, insights, model)
      VALUES (${key}, ${JSON.stringify(insights)}::jsonb, ${model})
      ON CONFLICT (input_hash) DO UPDATE
        SET insights = EXCLUDED.insights,
            model = EXCLUDED.model,
            generated_at = now(),
            hit_count = app.dupont_insights_cache.hit_count + 1,
            last_hit_at = now()
    `);
  } catch {
    /* silent fail — el cache es best-effort, no debe romper la request */
  }
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});

    const body = (await req.json().catch(() => null)) as { data?: DupontData } | null;
    if (!body?.data || !Array.isArray(body.data.entidades) || !Array.isArray(body.data.filas)) {
      throw new ValidationError("Body invalido: falta 'data' con entidades+filas", {});
    }
    const data = body.data;
    const key = hashInput(data);

    // 1. Microcache in-memory (dedupea requests concurrentes al mismo hash
    //    dentro de 60s — evita race conditions cross-request).
    const micro = MICROCACHE.get(key);
    if (micro && Date.now() - micro.at < MICROCACHE_TTL_MS) {
      return {
        narrativa: micro.insights,
        model: micro.model,
        cached: true,
        cacheLayer: "memory",
      };
    }

    // 2. Deduplication: si otra request esta generando el mismo hash,
    //    esperarla en lugar de disparar Claude de nuevo.
    const inflight = INFLIGHT.get(key);
    if (inflight) {
      const hit = await inflight;
      if (hit) {
        return {
          narrativa: hit.insights,
          model: hit.model,
          cached: true,
          cacheLayer: "inflight",
        };
      }
    }

    // 3. DB cache cross-user cross-deploy — la fuente de verdad.
    const dbHit = await checkDbCache(key);
    if (dbHit) {
      MICROCACHE.set(key, dbHit);
      pruneMicrocache();
      return {
        narrativa: dbHit.insights,
        model: dbHit.model,
        cached: true,
        cacheLayer: "db",
      };
    }

    // 4. Cache miss — llamar Claude. Registrar la promise en INFLIGHT para
    //    que requests concurrentes al mismo hash esperen esta.
    const promise = (async (): Promise<InMemHit | null> => {
      let provider;
      try {
        provider = await getProviderForCliente(null);
      } catch {
        return null;
      }

      let insights: Insights | null = null;
      try {
        const result = await provider.generate(buildUserPrompt(data), {
          system: SYSTEM_PROMPT,
          maxTokens: 900,
          temperature: 0.3,
        });
        insights = parseInsights(result.text);
      } catch {
        return null;
      }

      if (!insights) return null;

      // Persist en DB (fire-and-forget, no bloquea la respuesta al user)
      saveDbCache(key, insights, provider.name).catch(() => {});

      return { at: Date.now(), insights, model: provider.name };
    })();

    INFLIGHT.set(key, promise);
    let result: InMemHit | null = null;
    try {
      result = await promise;
    } finally {
      INFLIGHT.delete(key);
    }

    if (!result) {
      // Sin provider o LLM fallo — cliente hace fallback a narrativa determ.
      return { narrativa: null, model: null, cached: false };
    }

    MICROCACHE.set(key, result);
    pruneMicrocache();
    return {
      narrativa: result.insights,
      model: result.model,
      cached: false,
      cacheLayer: "llm",
    };
  });
}
