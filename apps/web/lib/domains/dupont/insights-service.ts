/**
 * Service compartido entre el endpoint /api/v1/dupont/insights y el
 * server component /dashboard/dupont/page.tsx.
 *
 * MOTIVO DE EXTRACCION:
 * Antes el fetch al LLM era 100% client-side (hook useNarrativaIA). Cada
 * navegacion (cambio de tab y vuelta) remontaba el componente y disparaba
 * el fetch nuevamente. Aunque el endpoint devolvia cache DB en <100ms,
 * el usuario veia "Generando..." por ese lapso corto → UX ruidoso.
 *
 * FIX (patron benchmark /informe):
 * page.tsx (server) llama getDupontInsightsFromCache(data) — solo lee DB,
 * NO invoca LLM. Si hit, pasa insights como prop al client → SSR renderiza
 * con narrativa ya presente, cero loading, cero fetch cliente.
 *
 * Si miss (primera vez para ese peer group), prop = null y el client
 * dispara /api/v1/dupont/insights (que sí llama al LLM y persiste en DB).
 * Siguiente user tendrá cache hit desde SSR.
 */

import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import type { DupontData } from "./types";

export type DupontInsights = {
  roe: string[];
  roa: string[];
  mon: string[];
  mfb: string[];
};

// Bump esto cuando cambies el SYSTEM_PROMPT del LLM o el shape del user
// prompt. Las entradas DB viejas quedan huerfanas (nunca hit) y se
// regeneran con el prompt nuevo.
// v3-dupont-math: agregado bloque "MATEMATICA DUPONT (INVIOLABLE)" al
// SYSTEM_PROMPT para prevenir causalidad invertida (bug reportado:
// "Compartamos dispara ROE porque mantiene apalancamiento controlado
// en 4.63x" — apalancamiento bajo REDUCE ROE, no lo dispara).
// v4-leverage-x-explained: prohibido escribir "(4.63x)" o "(10.53x a 8.53x)"
// sin traducirlo la primera vez ("apalancamiento de 10.53 veces — cada sol
// de patrimonio sostiene 10.53 soles de activos"). Lector no financiero no
// sabe que significa la "x" a secas (bug reportado 2026-08-10).
export const DUPONT_PROMPT_VERSION = "v4-leverage-x-explained";

/**
 * Hash del input estable para el cache. Debe matchear EXACTAMENTE el hash
 * usado en el endpoint (misma fuente de verdad — evitar drift).
 */
export function hashDupontInput(data: DupontData): string {
  const h = createHash("sha256");
  h.update(
    JSON.stringify({
      v: DUPONT_PROMPT_VERSION,
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
    }),
  );
  return h.digest("hex").slice(0, 32);
}

/**
 * Solo LECTURA del cache DB. NO llama al LLM. Silent fail (retorna null
 * si el cache no tiene el hash o la query falla).
 *
 * Se usa desde page.tsx (SSR) para poblar los insights iniciales sin
 * disparar generacion. Si retorna null, el cliente hace fetch on-mount.
 */
export async function getDupontInsightsFromCache(
  data: DupontData,
): Promise<{ insights: DupontInsights; model: string | null } | null> {
  try {
    const key = hashDupontInput(data);
    const rows = await db.execute<{ insights: DupontInsights; model: string | null }>(
      sql`SELECT insights, model FROM app.dupont_insights_cache WHERE input_hash = ${key} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return null;
    // Touch en background — no bloqueamos el render
    db.execute(sql`SELECT app.dupont_insights_touch(${key})`).catch(() => {});
    return { insights: row.insights, model: row.model };
  } catch {
    return null;
  }
}

/**
 * Persist insights generados en el cache DB. Idempotente via ON CONFLICT.
 * Silent fail — cache es best-effort, no debe romper el flow.
 */
export async function saveDupontInsightsToCache(
  data: DupontData,
  insights: DupontInsights,
  model: string,
): Promise<void> {
  try {
    const key = hashDupontInput(data);
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
    /* silent */
  }
}
