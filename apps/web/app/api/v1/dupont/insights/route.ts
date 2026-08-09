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

import { auth } from "@/lib/auth";
import {
  handleRoute,
  UnauthorizedError,
  ValidationError,
} from "@/lib/domains/shared";
import { getProviderForCliente } from "@/lib/domains/llm-vault";
import type { DupontData } from "@/lib/domains/dupont";
import {
  hashDupontInput,
  getDupontInsightsFromCache,
  saveDupontInsightsToCache,
  DUPONT_PROMPT_VERSION,
} from "@/lib/domains/dupont";

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

// hashDupontInput + DUPONT_PROMPT_VERSION vienen del service compartido
// (insights-service.ts). Sirven de fuente unica de verdad entre este
// endpoint y el server component /dashboard/dupont/page.tsx — asi los
// hashes que calcula el SSR coinciden EXACTAMENTE con los que calcula
// este endpoint (evita cache miss por drift de version).

// Prompt system: define tono, formato de output y reglas estrictas.
//
// Filosofia editorial: New York Times — Business/Finance section.
// Cada insight es una MICRO-HISTORIA que un lector no financiero
// puede entender. Datos siempre acompañados de interpretacion humana.
// Prohibido usar siglas (MFB, MON, ISFN, ROE, ROA) sin explicar la
// primera vez que aparecen o parafrasearlas siempre en lenguaje llano.
//
// Reforzamos el castellano peruano (tuteo) y NO voseo argentino porque
// Claude tiende al voseo por default. Regla de oro del proyecto — ver
// feedback_castellano_peruano en el memory system.
const SYSTEM_PROMPT = `Eres un periodista financiero senior del New York Times, seccion Business, cubriendo el sistema microfinanciero peruano (SBS). Escribes para directores y gerentes generales que NO son expertos en finanzas — necesitan entender el analisis sin diccionario. Tu trabajo es traducir un analisis DuPont (arbol de rentabilidad) en insights que iluminen, no que confundan.

FORMATO DE OUTPUT (ESTRICTO):
Devuelve SOLO JSON valido con exactamente esta forma:
{"roe":["...","..."],"roa":["...","..."],"mon":["...","..."],"mfb":["...","..."]}
- Cada nivel: 2 a 4 bullets.
- Cada bullet: 1 o 2 oraciones, maximo 32 palabras total.
- Sin markdown, sin emojis, sin negritas, sin listas anidadas.

REGLAS DE ESTILO NYT:

1. **PROHIBIDO usar siglas sin explicarlas.** Nada de "MFB 29.72%" pelado. Escribe "margen financiero bruto (el spread entre lo que cobra por prestamos y lo que paga por fondeo): 29.72%" la primera vez que aparece. Despues puedes usar "margen" o "spread" a secas.

2. **Traduce jerga tecnica a lenguaje humano.** Ejemplos:
   - "Apalancamiento 8.34×" → "por cada sol de capital propio, tiene 8.34 soles trabajando en la calle"
   - "ROE 27.47%" → "cada sol de patrimonio le rinde 27 centavos al año"
   - "ROA 5.93%" → "de cada 100 soles de activos, gana 5.93 al año"
   - "Provisiones -3.5%" → "gasta 3.5% de sus activos cubriendo prestamos que no cobra"

3. **Storytelling con datos.** No es una lista de metricas: es un mini-relato. Un bullet malo dice "X 27%, Y 20%". Un bullet NYT dice "Compartamos convierte cada sol de patrimonio en 27 centavos anuales, gracias a que cobra tasas casi el triple de las cajas."

4. **Contexto + causa + implicancia.** Cuando notas un dato notable, en el mismo bullet:
   - QUÉ pasa (el dato)
   - POR QUÉ pasa (la causa segun el arbol)
   - QUÉ significa (implicancia para el negocio)

5. **Prioriza contraste dramatico:** lider vs rezagado, quiebre historico, palanca oculta que explica el resto. Si dos entidades tienen ROE similar pero por razones opuestas (una por apalancamiento, otra por margen), eso es GOLD — dilo asi.

6. **Datos siempre con valores exactos**, nunca aproximaciones. "27.47%", no "casi 28%". Los CFO odian numeros redondeados.

7. **Escribe como si tuvieras 60 segundos** para explicar en una reunion de directorio. Sin adornos innecesarios, sin obviedades ("todas las entidades tienen ROE"). Cada bullet debe hacer al lector detenerse a pensar.

8. **Castellano peruano estricto.** Tuteo (tu tienes, muestra, gana). NUNCA voseo argentino (vos tenes, mostra, ganas) — esta prohibido.

9. **Si falta data en una entidad, no la menciones** en ese bullet. No inventes ni digas "N/D".

CONTEXTO DE LOS 4 NIVELES (con traducciones sugeridas):

- **ROE (rentabilidad sobre patrimonio):** cuanto renta cada sol de capital de los dueños. "Retorno sobre patrimonio" o "rentabilidad del capital".
- **ROA (rentabilidad sobre activos):** cuanto renta cada sol de activos. "Retorno sobre activos" o "rentabilidad de la cartera".
- **Apalancamiento (activos/patrimonio):** cuantos soles de activos por cada sol de capital propio. "Palanca" o "multiplicador de capital".
- **Margen operativo neto:** ganancia despues de todos los costos operativos (personal, oficinas, provisiones), antes de impuestos.
- **Margen financiero bruto:** diferencia entre ingresos por prestamos e inversiones vs costo de fondeo. "Spread financiero" o "margen de intermediacion".
- **Ingresos de cartera:** intereses cobrados por prestamos activos.
- **Ingresos de inversion:** intereses ganados por inversiones (bonos, disponibles, etc.).
- **Gastos financieros:** intereses pagados por fondeo (depositos, adeudos, etc.).
- **Gasto de personal:** salarios + beneficios sociales.
- **Gastos generales:** oficinas, servicios, depreciacion, etc.
- **Gasto de provisiones:** dinero apartado por prestamos que probablemente no se cobren.
- **Ingresos por servicios financieros netos:** comisiones cobradas menos comisiones pagadas.
- **Otros ingresos netos:** ingresos extraordinarios, recuperos, etc.
- **Impuestos:** impuesto a la renta + participacion trabajadores.`;

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

// checkDbCache y saveDbCache movidas a insights-service.ts como
// getDupontInsightsFromCache y saveDupontInsightsToCache — fuente unica
// de verdad compartida con page.tsx (SSR).

export async function POST(req: Request) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});

    const body = (await req.json().catch(() => null)) as { data?: DupontData } | null;
    if (!body?.data || !Array.isArray(body.data.entidades) || !Array.isArray(body.data.filas)) {
      throw new ValidationError("Body invalido: falta 'data' con entidades+filas", {});
    }
    const data = body.data;
    const key = hashDupontInput(data);

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
    const dbHit = await getDupontInsightsFromCache(data);
    if (dbHit) {
      const entry: InMemHit = {
        at: Date.now(),
        insights: dbHit.insights,
        model: dbHit.model,
      };
      MICROCACHE.set(key, entry);
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
          // 1500 tokens ≈ 3-4 bullets × 4 secciones × 32 palabras + JSON
          // overhead. Storytelling NYT necesita mas espacio que el prompt
          // punchy anterior (900 tokens).
          maxTokens: 1500,
          // 0.4 da variedad narrativa sin perder rigor. 0.3 sonaba
          // demasiado formulaico.
          temperature: 0.4,
        });
        insights = parseInsights(result.text);
      } catch {
        return null;
      }

      if (!insights) return null;

      // Persist en DB (fire-and-forget, no bloquea la respuesta al user)
      saveDupontInsightsToCache(data, insights, provider.name).catch(() => {});

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
