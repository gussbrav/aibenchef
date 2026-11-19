/**
 * Entity Profiles — fichas de perfil de entidad enriquecidas con research
 * automatico (Claude + web_search) y persistidas en gov.entity_profiles.
 *
 * Orquestacion high-level: ensureProfilesForEntities() es el entrypoint
 * que usa el enrichment de insights — hace lookup bulk, research de las
 * que falten (respetando rate limit), y devuelve todas las que tengamos.
 */

import "server-only";

import {
  getEntityProfilesBulk,
  bumpUsage,
  upsertEntityProfileFromResearch,
} from "./repository";
import { researchEntityProfile, ResearchError } from "./research";
import { tryConsumeResearch } from "./rate-limit";
import type { EntityProfile } from "./types";

export type { EntityProfile, ModeloNegocio } from "./types";
export {
  getEntityProfile,
  getEntityProfilesBulk,
  listProfiles,
  verifyProfile,
  bumpUsage,
} from "./repository";
export { getRateLimitStatus } from "./rate-limit";
export { researchEntityProfile, ResearchError } from "./research";

/**
 * Entrypoint del enrichment: dado un conjunto de entidades + sus tipos,
 * devuelve el mapa de perfiles disponibles. Lo que no esta en cache se
 * investiga inline (sincrono) mientras haya cupo de rate limit del dia.
 *
 * Si todo falla, devuelve un Map vacio — el caller (prompt v13) degrada
 * gracefully.
 */
export async function ensureProfilesForEntities(
  entidades: Array<{ nombCorreg: string; tipoEntidad: string | null }>,
): Promise<Map<string, EntityProfile>> {
  if (entidades.length === 0) return new Map();

  const nombres = Array.from(new Set(entidades.map((e) => e.nombCorreg)));
  const cache = await getEntityProfilesBulk(nombres);

  // Las que faltan por investigar — en orden original para research
  // deterministico en caso de rate limit
  const faltantes = entidades.filter((e) => !cache.has(e.nombCorreg));

  if (faltantes.length > 0) {
    for (const ent of faltantes) {
      // Chequeamos + consumimos un slot del rate limit por cada research
      // ANTES de disparar la llamada a Claude. Si no hay cupo, salimos.
      const allowed = await tryConsumeResearch(0); // reserva slot con costo 0
      if (!allowed) break;

      try {
        const result = await researchEntityProfile({
          nombCorreg: ent.nombCorreg,
          tipoEntidad: ent.tipoEntidad,
        });
        const saved = await upsertEntityProfileFromResearch({
          nombCorreg: ent.nombCorreg,
          tipoEntidad: ent.tipoEntidad,
          ubicacion: result.profile.ubicacion,
          inicioOperaciones: result.profile.inicioOperaciones,
          rucSunat: result.profile.rucSunat,
          publicoObjetivo: result.profile.publicoObjetivo,
          modeloNegocio: result.profile.modeloNegocio,
          segmentoCarteraHipotesis: result.profile.segmentoCarteraHipotesis,
          productosPrincipales: result.profile.productosPrincipales,
          notas: result.profile.notas,
          fuentes: result.profile.fuentes,
          researchModel: result.metadata.model,
          researchCostUsd: result.metadata.costUsd,
        });
        cache.set(ent.nombCorreg, saved);
      } catch (err) {
        // best-effort: si falla un research, loggeamos y seguimos con los
        // demas. El prompt degrada declarando que no hay profile.
        if (err instanceof ResearchError) {
          // eslint-disable-next-line no-console
          console.warn(
            `[entity-profiles] research failed for ${ent.nombCorreg}: ${err.code} — ${err.message}`,
          );
        } else {
          // eslint-disable-next-line no-console
          console.warn(
            `[entity-profiles] unexpected research error for ${ent.nombCorreg}:`,
            err,
          );
        }
      }
    }
  }

  // Bump usage de todas las que efectivamente tenemos (cache + recien
  // investigadas) — best effort
  if (cache.size > 0) {
    await bumpUsage(Array.from(cache.keys()));
  }

  return cache;
}
