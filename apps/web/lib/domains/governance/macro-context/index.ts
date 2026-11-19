/**
 * Macro context — snapshots del contexto macro vigente del sistema
 * financiero peruano. Alimenta los analisis de IA con eventos reales en
 * curso (Niño, tasas, regulatorio, politico, sectorial).
 */

import "server-only";

import {
  expireStaleItems,
  finishRefreshLog,
  insertResearchItem,
  startRefreshLog,
} from "./repository";
import { researchMacroContext, MacroResearchError } from "./research";
import type { MacroRefreshResult } from "./types";

export type {
  MacroCategoria,
  MacroSeveridad,
  MacroContextItem,
  MacroResearchItem,
} from "./types";

export {
  getVigentes,
  listAll,
  updateItem,
  verifyItem,
  deleteItem,
  getLastRefresh,
} from "./repository";

export { researchMacroContext, MacroResearchError } from "./research";

/**
 * Entry-point del refresh — llama a researchMacroContext, persiste los
 * items nuevos, expira los vencidos, y registra en el log de refresh.
 */
export async function refreshMacroContext(triggeredBy: string): Promise<MacroRefreshResult> {
  const logId = await startRefreshLog(triggeredBy);
  try {
    const result = await researchMacroContext();
    let itemsCreated = 0;
    for (const item of result.items) {
      await insertResearchItem({
        categoria: item.categoria,
        titulo: item.titulo,
        resumen: item.resumen,
        impacto: item.impacto,
        severidad: item.severidad,
        vigenteHasta: item.vigente_hasta,
        fuentes: item.fuentes,
        researchModel: result.metadata.model,
        researchCostUsd: result.metadata.costUsd / Math.max(1, result.items.length),
      });
      itemsCreated++;
    }
    const itemsExpired = await expireStaleItems();
    await finishRefreshLog({
      id: logId,
      itemsCreated,
      itemsUpdated: 0,
      itemsExpired,
      costUsd: result.metadata.costUsd,
      status: "ok",
    });
    return {
      logId,
      itemsCreated,
      itemsUpdated: 0,
      itemsExpired,
      costUsd: result.metadata.costUsd,
      status: "ok",
    };
  } catch (err) {
    const message =
      err instanceof MacroResearchError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    await finishRefreshLog({
      id: logId,
      itemsCreated: 0,
      itemsUpdated: 0,
      itemsExpired: 0,
      costUsd: 0,
      status: "failed",
      error: message,
    });
    return {
      logId,
      itemsCreated: 0,
      itemsUpdated: 0,
      itemsExpired: 0,
      costUsd: 0,
      status: "failed",
      error: message,
    };
  }
}
