/**
 * Service principal — genera o retorna cache de un insight.
 *
 * Flujo:
 *   1. Calcular peer_group_hash
 *   2. Buscar en cache (admin.report_insights)
 *   3. Si hit -> retornar bullets (o override si existe)
 *   4. Si miss:
 *      a. Chequear rate limit (por cliente + por usuario)
 *      b. Resolver LLM provider via vault
 *      c. Ejecutar prompt
 *      d. Parsear output (JSON array de strings)
 *      e. Persistir en cache + registrar usage
 *      f. Retornar bullets
 */

import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";
import { getProviderForCliente, LlmProviderError } from "@/lib/domains/llm-vault";
import { peerGroupHash } from "./hash";
import { promptMargenNeto } from "./prompts/margen-neto";
import { promptCarteraBruta } from "./prompts/cartera-bruta";
import { promptMoraGlobal } from "./prompts/mora-global";
import { promptSolvencia } from "./prompts/solvencia";
import { promptLiquidez } from "./prompts/liquidez";
import { promptCobertura } from "./prompts/cobertura";
import { promptPuntoEquilibrio } from "./prompts/punto-equilibrio";
import type { PromptTemplate } from "./prompts/base";
import type {
  GenerateInsightInput,
  GenerateInsightResult,
  InsightSeccion,
  PromptContext,
  ReportInsight,
} from "./types";

const PROMPT_REGISTRY: Partial<Record<InsightSeccion, PromptTemplate>> = {
  margen_neto: promptMargenNeto,
  cartera_bruta: promptCarteraBruta,
  mora_global: promptMoraGlobal,
  solvencia: promptSolvencia,
  liquidez: promptLiquidez,
  cobertura: promptCobertura,
  punto_equilibrio: promptPuntoEquilibrio,
};

/**
 * Version actual del prompt para una seccion. Se usa como cache-key
 * implicito: si la version cambia, un cache "hit" con version distinta
 * se trata como MISS y se regenera (invalidacion transparente).
 */
export function getCurrentPromptVersion(seccion: InsightSeccion): string | null {
  return PROMPT_REGISTRY[seccion]?.version ?? null;
}

export class InsightsError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "rate_limit"
      | "no_provider"
      | "llm_error"
      | "parse_error"
      | "unsupported_seccion",
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "InsightsError";
  }
}

/**
 * Devuelve el insight cacheado si existe. NO genera si falta —
 * usar para el fetch inicial del componente (evita costos accidentales).
 */
export async function getCachedInsight(
  input: Pick<GenerateInsightInput, "periodo" | "seccion" | "entidadPropia" | "peerGroup">,
): Promise<ReportInsight | null> {
  const hash = peerGroupHash(input.peerGroup, input.entidadPropia);
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT id, periodo, seccion, peer_group_hash, cliente_slug,
           bullets, override_bullets, override_reason,
           model, prompt_version,
           tokens_input, tokens_output, cost_usd,
           generated_at, generated_by, duration_ms,
           reviewed_at, reviewed_by
      FROM admin.report_insights
     WHERE periodo = ${input.periodo}::int
       AND seccion = ${input.seccion}::text
       AND peer_group_hash = ${hash}::text
     LIMIT 1
  `);
  const r = rows[0];
  return r ? rowToInsight(r) : null;
}

/**
 * Genera un insight (o devuelve cache si existe). Chequea rate limits
 * antes de llamar al LLM.
 */
export async function generateInsight(
  input: GenerateInsightInput,
  actor: { email: string },
): Promise<GenerateInsightResult> {
  // Verificar seccion soportada
  const template = PROMPT_REGISTRY[input.seccion];
  if (!template) {
    throw new InsightsError(
      `Seccion '${input.seccion}' no tiene prompt template implementado`,
      "unsupported_seccion",
    );
  }

  // Cache check — solo hit si la version del cache coincide con la
  // version actual del template. Si un override manual existe, respetarlo
  // incluso si la version base cambio.
  const cached = await getCachedInsight(input);
  const versionMatch = cached?.promptVersion === template.version;
  if (cached && (versionMatch || cached.overrideBullets)) {
    return {
      bullets: cached.overrideBullets ?? cached.bullets,
      model: cached.model,
      tokensInput: cached.tokensInput,
      tokensOutput: cached.tokensOutput,
      costUsd: cached.costUsd,
      durationMs: cached.durationMs ?? 0,
      fromCache: true,
    };
  }

  // Rate limit check
  const rateCheck = await db.execute<{ result: Record<string, unknown> }>(sql`
    SELECT admin.check_insights_rate_limit(${input.clienteSlug}::text, ${actor.email}::text) AS result
  `);
  const rl = rateCheck[0]?.result;
  if (rl && rl.allowed === false) {
    throw new InsightsError(
      `Rate limit alcanzado: ${rl.reason}`,
      "rate_limit",
      rl as Record<string, unknown>,
    );
  }

  // Resolver provider
  let provider;
  try {
    provider = await getProviderForCliente(input.clienteSlug);
  } catch (err) {
    if (err instanceof LlmProviderError) {
      throw new InsightsError(err.message, "no_provider");
    }
    throw err;
  }

  // Armar prompt context. Para punto_equilibrio v4 enriquecemos server-side
  // con indicadores oficiales SBS (mora, ROE) y montos absolutos — el client
  // solo envia ratios, lo que hace que el LLM confunda "ratio bajo" con
  // "recorte de costos" cuando en realidad el denominador (cartera) crecio.
  const periodoAnterior = calcularPeriodoAnterior(input.periodo);
  const enrichedInput = await maybeEnrichContext(input);
  const promptCtx: PromptContext = {
    ...enrichedInput,
    periodoLabel: periodoLabel(input.periodo),
    periodoAnterior,
    periodoAnteriorLabel: periodoLabel(periodoAnterior),
  };
  const { system, user } = template.build(promptCtx);

  // Llamar al LLM. maxTokens=4000 permite output de 5-7 bullets de 2-4
  // lineas cada uno con analisis causal + cierre prescriptivo (Implica/
  // Accion/Riesgo). Bajo esto los prompts v4 se truncan a mitad del array.
  const t0 = Date.now();
  let result;
  try {
    result = await provider.generate(user, { system, maxTokens: 4000 });
  } catch (err) {
    throw new InsightsError(
      err instanceof Error ? err.message : String(err),
      "llm_error",
    );
  }
  const durationMs = Date.now() - t0;

  // Parsear output: debe ser JSON array de strings
  const bullets = parseBulletsJson(result.text);
  if (bullets.length === 0) {
    throw new InsightsError(
      `LLM devolvio output no parseable como JSON array. Raw: ${result.text.slice(0, 200)}`,
      "parse_error",
    );
  }

  // Persistir en cache + usage
  const hash = peerGroupHash(input.peerGroup, input.entidadPropia);
  // Drizzle serializa arrays JS como tupla/record cuando se pasan como
  // parametro con cast ::text[]. Fix: construir array literal explicito
  // con ARRAY[...]::text[] usando sql.join sobre cada bullet.
  const bulletsSql =
    bullets.length === 0
      ? sql`ARRAY[]::text[]`
      : sql`ARRAY[${sql.join(bullets.map((b) => sql`${b}`), sql`, `)}]::text[]`;

  await db.execute(sql`
    INSERT INTO admin.report_insights (
      periodo, seccion, peer_group_hash, cliente_slug,
      bullets, model, prompt_version,
      contexto_json,
      tokens_input, tokens_output, cost_usd,
      generated_by, duration_ms
    ) VALUES (
      ${input.periodo}::int,
      ${input.seccion}::text,
      ${hash}::text,
      ${input.clienteSlug}::text,
      ${bulletsSql},
      ${result.model}::text,
      ${template.version}::text,
      ${JSON.stringify(input.contexto)}::jsonb,
      ${result.usage.inputTokens}::int,
      ${result.usage.outputTokens}::int,
      ${result.usage.costUsd}::numeric,
      ${`user:${actor.email}`}::text,
      ${durationMs}::int
    )
    ON CONFLICT (periodo, seccion, peer_group_hash)
    DO UPDATE SET
      bullets        = EXCLUDED.bullets,
      model          = EXCLUDED.model,
      prompt_version = EXCLUDED.prompt_version,
      contexto_json  = EXCLUDED.contexto_json,
      tokens_input   = EXCLUDED.tokens_input,
      tokens_output  = EXCLUDED.tokens_output,
      cost_usd       = EXCLUDED.cost_usd,
      generated_at   = now(),
      generated_by   = EXCLUDED.generated_by,
      duration_ms    = EXCLUDED.duration_ms
  `);

  // Registrar usage del usuario para rate limit
  await db
    .execute(sql`
      INSERT INTO admin.insights_user_usage
        (user_email, cliente_slug, periodo, seccion, cost_usd)
      VALUES (
        ${actor.email}::text,
        ${input.clienteSlug}::text,
        ${input.periodo}::int,
        ${input.seccion}::text,
        ${result.usage.costUsd}::numeric
      )
    `)
    .catch(() => {
      // best-effort — no romper la generacion si falla el usage log
    });

  return {
    bullets,
    model: result.model,
    tokensInput: result.usage.inputTokens,
    tokensOutput: result.usage.outputTokens,
    costUsd: result.usage.costUsd,
    durationMs,
    fromCache: false,
  };
}

/**
 * Parsea el output del LLM como JSON array de strings.
 * Tolera desviaciones: markdown fences, whitespace, trailing commas y
 * truncados (si el LLM se corto a mitad de bullet, salvamos los completos).
 */
function parseBulletsJson(text: string): string[] {
  const cleaned = text
    .trim()
    // Quitar ```json ... ``` si el LLM se equivoco
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Intento directo
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
  } catch {
    // fallthrough
  }

  // Recuperacion de truncados: intenta cerrar el array recortando hasta
  // el ultimo string bien cerrado. Ejemplo: `["a", "b", "c incom`
  //   -> retry como `["a", "b"]`
  const startIdx = cleaned.indexOf("[");
  if (startIdx < 0) return [];
  const body = cleaned.slice(startIdx);
  // Encuentra la ultima comilla-doble que abre O cierra un string bien
  // formado, y recorta ahi para intentar reparar.
  for (let end = body.length - 1; end > 0; end--) {
    if (body[end] !== "\"") continue;
    const candidate = body.slice(0, end + 1).replace(/,\s*$/, "") + "]";
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
    } catch {
      // sigue buscando
    }
  }

  return [];
}

function calcularPeriodoAnterior(periodo: number): number {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  return (anio - 1) * 100 + mes;
}

function periodoLabel(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${meses[mes - 1] ?? "?"} ${anio}`;
}

/**
 * Enriquece el contexto con datos server-side cuando la seccion lo necesita.
 * Hoy solo aplica a punto_equilibrio v4, que requiere:
 *   - moraReal, roe: indicador oficial SBS por entidad en el periodo del cierre
 *   - montosPropia: cartera bruta absoluta de la entidad propia en los
 *     periodos de la tendencia (para que el LLM pueda afirmar movimiento
 *     absoluto en vez de "recorto costos" por caida de ratio)
 *
 * Si la seccion no lo necesita o la query falla, devuelve el input intacto.
 * Nunca rompe la generacion por un fallo de enriquecimiento — es best-effort.
 */
async function maybeEnrichContext(
  input: GenerateInsightInput,
): Promise<GenerateInsightInput> {
  if (input.seccion !== "punto_equilibrio") return input;

  try {
    const existingContexto = input.contexto ?? {};
    // No sobrescribir si el client ya envio los campos (ej. test o bypass).
    const yaTieneMora = "moraReal" in existingContexto;
    const yaTieneRoe = "roe" in existingContexto;
    const yaTieneCobertura = "coberturaAtrasados" in existingContexto;
    const yaTieneMontos = "montosPropia" in existingContexto;
    const yaTienePromedios = "promediosPorTipo" in existingContexto;
    const yaTienePerfiles = "perfilesEntidad" in existingContexto;
    if (
      yaTieneMora &&
      yaTieneRoe &&
      yaTieneCobertura &&
      yaTieneMontos &&
      yaTienePromedios &&
      yaTienePerfiles
    ) {
      return input;
    }

    const peerGroupConPropia = Array.from(
      new Set([input.entidadPropia, ...input.peerGroup]),
    );

    // Tipos presentes en el peer group — sale del lookup que inyecta el
    // cliente. Se usa para traer promedios por tipo_entidad (CMAC, COOPAC_N1,
    // etc) para que el LLM pueda anclar la comparacion contra el universo
    // real del tipo. Fallback: si el client no envio tipoPorEntidad,
    // intentamos todos los tipos conocidos.
    const tipoPorEntidadInput = (existingContexto.tipoPorEntidad ?? {}) as Record<string, string>;
    const tiposPresentes = Array.from(
      new Set(Object.values(tipoPorEntidadInput).filter((t) => !!t && t !== "")),
    );
    const tiposParaPromedios = tiposPresentes.length > 0
      ? tiposPresentes
      : ["BANCOS", "FINANCIERAS", "CMAC", "CRAC", "EDPYMES",
         "COOPAC_N1", "COOPAC_N2A", "COOPAC_N2B", "COOPAC_N3"];

    const [indRows, montosRows, promedioRows] = await Promise.all([
      !yaTieneMora || !yaTieneRoe || !yaTieneCobertura
        ? db.execute<{
            nomb_correg: string;
            mora: string | null;
            roe: string | null;
            cobertura: string | null;
            periodo_dato: number | null;
          }>(sql`
            -- Para cada entidad, tomar el ULTIMO periodo <= input.periodo
            -- que tenga AL MENOS un indicador poblado. COOPAC se publica
            -- con delay — si Sep 2026 no esta aun, cae a Jun 2026, etc.
            SELECT DISTINCT ON (er.nomb_correg)
                   er.nomb_correg,
                   COALESCE(ind.mora_atrasados_sobre_directos / 100.0,
                            er.ratio_mora)::text          AS mora,
                   COALESCE(ind.roe_sbs / 100.0,
                            er.roe)::text                 AS roe,
                   COALESCE(ind.provisiones_sobre_atrasados / 100.0,
                            er.ratio_cobertura_atrasados)::text AS cobertura,
                   er.periodo                             AS periodo_dato
              FROM marts.mv_eeff_ratios er
              LEFT JOIN marts.v_indicadores_ancho ind
                     ON ind.periodo    = er.periodo
                    AND ind.nomb_correg = er.nomb_correg
             WHERE er.periodo   <= ${input.periodo}
               AND er.moneda     = 'TOTAL'
               AND er.nomb_correg = ANY(${peerGroupConPropia}::text[])
               AND (er.ratio_mora IS NOT NULL
                    OR ind.mora_atrasados_sobre_directos IS NOT NULL
                    OR er.roe IS NOT NULL
                    OR ind.roe_sbs IS NOT NULL
                    OR er.ratio_cobertura_atrasados IS NOT NULL
                    OR ind.provisiones_sobre_atrasados IS NOT NULL)
             ORDER BY er.nomb_correg, er.periodo DESC
          `)
        : Promise.resolve([]),
      !yaTieneMontos
        ? db.execute<{
            periodo: number;
            cartera_mm: string | null;
          }>(sql`
            SELECT periodo,
                   (cartera_bruta / 1000.0)::text AS cartera_mm
              FROM marts.mv_eeff_ratios
             WHERE nomb_correg = ${input.entidadPropia}
               AND moneda      = 'TOTAL'
               AND periodo    <= ${input.periodo}
             ORDER BY periodo DESC
             LIMIT 4
          `)
        : Promise.resolve([]),
      !yaTienePromedios
        ? db.execute<{
            tipo_entidad: string;
            periodo: number;
            n_entidades: number;
            mora_prom: string | null;
            cobertura_prom: string | null;
            roe_prom: string | null;
            roa_prom: string | null;
          }>(sql`
            -- Promedio simple (no ponderado) por tipo_entidad al ultimo
            -- periodo disponible por tipo, replicando la logica del
            -- dashboard /estadisticas-rapidas. Permite al LLM anclar
            -- la comparacion de la entidad propia contra su universo.
            WITH ultimo_por_tipo AS (
              SELECT tipo_entidad, MAX(periodo) AS ultimo_periodo
                FROM marts.mv_eeff_ratios
               WHERE moneda = 'TOTAL'
                 AND periodo <= ${input.periodo}
                 AND tipo_entidad = ANY(${tiposParaPromedios}::text[])
               GROUP BY tipo_entidad
            )
            SELECT
              er.tipo_entidad,
              er.periodo,
              COUNT(*)::int                       AS n_entidades,
              AVG(er.ratio_mora)::text            AS mora_prom,
              AVG(er.ratio_cobertura_atrasados)::text AS cobertura_prom,
              AVG(er.roe)::text                   AS roe_prom,
              AVG(er.roa)::text                   AS roa_prom
            FROM marts.mv_eeff_ratios er
            INNER JOIN ultimo_por_tipo u
                    ON u.tipo_entidad   = er.tipo_entidad
                   AND u.ultimo_periodo = er.periodo
            WHERE er.moneda = 'TOTAL'
            GROUP BY er.tipo_entidad, er.periodo
          `)
        : Promise.resolve([]),
    ]);

    const moraReal: Record<string, number | null> = {};
    const roe: Record<string, number | null> = {};
    const coberturaAtrasados: Record<string, number | null> = {};
    // Mapa entidad -> periodo del dato (puede ser < input.periodo si la
    // entidad tiene delay de publicacion — comun en COOPAC).
    const periodoCalidad: Record<string, string> = {};
    for (const r of indRows) {
      moraReal[r.nomb_correg] = r.mora != null ? Number(r.mora) : null;
      roe[r.nomb_correg] = r.roe != null ? Number(r.roe) : null;
      coberturaAtrasados[r.nomb_correg] = r.cobertura != null ? Number(r.cobertura) : null;
      if (r.periodo_dato != null) {
        periodoCalidad[r.nomb_correg] = periodoLabel(Number(r.periodo_dato));
      }
    }

    const montosPropia = montosRows
      .filter((r) => r.cartera_mm != null)
      .map((r) => ({
        periodoLabel: periodoLabel(Number(r.periodo)),
        carteraBrutaMM: Number(r.cartera_mm),
      }))
      // Al orden cronologico ascendente para alinear con tendenciaPropia
      .reverse();

    // Promedios por tipo_entidad (para anclaje contra universo)
    const promediosPorTipo: Record<
      string,
      {
        periodoLabel: string;
        nEntidades: number;
        moraProm: number | null;
        coberturaProm: number | null;
        roeProm: number | null;
        roaProm: number | null;
      }
    > = {};
    for (const r of promedioRows) {
      promediosPorTipo[r.tipo_entidad] = {
        periodoLabel: periodoLabel(Number(r.periodo)),
        nEntidades: Number(r.n_entidades),
        moraProm: r.mora_prom != null ? Number(r.mora_prom) : null,
        coberturaProm: r.cobertura_prom != null ? Number(r.cobertura_prom) : null,
        roeProm: r.roe_prom != null ? Number(r.roe_prom) : null,
        roaProm: r.roa_prom != null ? Number(r.roa_prom) : null,
      };
    }

    // Macro context — items vigentes en gov.macro_context. Es un lookup
    // barato (una tabla chica), no dispara research. El research vive en
    // scripts/refresh-macro-context.ts y se ejecuta manual o cron.
    let contextoMacro: Array<{
      categoria: string;
      titulo: string;
      resumen: string;
      impacto: string | null;
      severidad: string;
      vigenteHasta: string | null;
      fuentes: string[];
    }> = [];
    const yaTieneMacro = "contextoMacro" in existingContexto;
    if (!yaTieneMacro) {
      try {
        const { getVigentes } = await import(
          "@/lib/domains/governance/macro-context"
        );
        const items = await getVigentes(15);
        contextoMacro = items.map((i) => ({
          categoria: i.categoria,
          titulo: i.titulo,
          resumen: i.resumen,
          impacto: i.impacto,
          severidad: i.severidad,
          vigenteHasta: i.vigenteHasta,
          fuentes: i.fuentes,
        }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[insights.enrichment] getVigentes macro fallo — se continua sin contexto macro:",
          err,
        );
      }
    }

    // Entity profiles — lookup cache + research inline de las faltantes,
    // respetando rate limit global (ver governance/entity-profiles/). Best-
    // effort: si falla, el prompt degrada declarando la falta.
    let perfilesEntidad: Record<string, {
      ubicacion: string | null;
      inicioOperaciones: string | null;
      publicoObjetivo: string | null;
      modeloNegocio: string | null;
      segmentoCarteraHipotesis: string | null;
      productosPrincipales: string | null;
      notas: string | null;
      fuentes: string[];
      verifiedByHuman: boolean;
    }> = {};
    if (!yaTienePerfiles) {
      try {
        const { ensureProfilesForEntities } = await import(
          "@/lib/domains/governance/entity-profiles"
        );
        const entidadesParaProfile = peerGroupConPropia.map((nombCorreg) => ({
          nombCorreg,
          tipoEntidad: tipoPorEntidadInput[nombCorreg] ?? null,
        }));
        const perfiles = await ensureProfilesForEntities(entidadesParaProfile);
        for (const [nombCorreg, perfil] of perfiles.entries()) {
          perfilesEntidad[nombCorreg] = {
            ubicacion: perfil.ubicacion,
            inicioOperaciones: perfil.inicioOperaciones,
            publicoObjetivo: perfil.publicoObjetivo,
            modeloNegocio: perfil.modeloNegocio,
            segmentoCarteraHipotesis: perfil.segmentoCarteraHipotesis,
            productosPrincipales: perfil.productosPrincipales,
            notas: perfil.notas,
            fuentes: perfil.fuentes,
            verifiedByHuman: perfil.verifiedByHuman,
          };
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[insights.enrichment] ensureProfilesForEntities fallo — se continua sin perfiles:",
          err,
        );
      }
    }

    return {
      ...input,
      contexto: {
        ...existingContexto,
        ...(yaTieneMora ? {} : { moraReal }),
        ...(yaTieneRoe ? {} : { roe }),
        ...(yaTieneCobertura ? {} : { coberturaAtrasados }),
        ...(yaTieneMontos ? {} : { montosPropia }),
        ...(yaTienePromedios ? {} : { promediosPorTipo }),
        ...(yaTienePerfiles ? {} : { perfilesEntidad }),
        ...(yaTieneMacro ? {} : { contextoMacro }),
        periodoCalidad,
      },
    };
  } catch {
    // best-effort: si falla la query, seguir con el contexto original.
    // El prompt v4 degrada declarando que no tiene los datos.
    return input;
  }
}

function rowToInsight(r: Record<string, unknown>): ReportInsight {
  return {
    id: String(r.id),
    periodo: Number(r.periodo),
    seccion: String(r.seccion) as InsightSeccion,
    peerGroupHash: String(r.peer_group_hash),
    clienteSlug: r.cliente_slug == null ? null : String(r.cliente_slug),
    bullets: (r.bullets ?? []) as string[],
    overrideBullets: (r.override_bullets ?? null) as string[] | null,
    overrideReason: r.override_reason == null ? null : String(r.override_reason),
    model: String(r.model),
    promptVersion: String(r.prompt_version),
    tokensInput: Number(r.tokens_input ?? 0),
    tokensOutput: Number(r.tokens_output ?? 0),
    costUsd: Number(r.cost_usd ?? 0),
    generatedAt: String(r.generated_at),
    generatedBy: String(r.generated_by),
    durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
    reviewedAt: r.reviewed_at == null ? null : String(r.reviewed_at),
    reviewedBy: r.reviewed_by == null ? null : String(r.reviewed_by),
  };
}
