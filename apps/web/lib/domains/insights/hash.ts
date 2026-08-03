/**
 * Hash del peer group — sirve como cache key para report_insights.
 *
 * Cuando el user cambia el peer group (agrega/quita/reordena entidades)
 * el hash cambia, invalidando el cache viejo automaticamente. Cuando
 * vuelve al peer default, el hash coincide y hace hit del cache.
 */

import { createHash } from "node:crypto";

/**
 * SHA-256 hex de la lista de entidades del peer group ordenada + la
 * entidad propia. Ejemplo:
 *
 *   peerGroup = ["BCP", "Confianza", "CMAC-A"]
 *   entidadPropia = "BCP"
 *   -> "BCP,CMAC-A,Confianza|BCP" -> sha256
 *
 * El sort garantiza que el orden en el array del user no afecte al hash
 * (el orden de columnas cambia el layout visual, no el analisis LLM).
 */
export function peerGroupHash(peerGroup: string[], entidadPropia: string): string {
  const sorted = [...peerGroup].sort((a, b) => a.localeCompare(b));
  const key = `${sorted.join(",")}|${entidadPropia}`;
  return createHash("sha256").update(key).digest("hex");
}
