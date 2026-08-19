/**
 * GET /api/v1/eeff/metadata
 *
 * Devuelve listas necesarias para los selectores del dashboard EEFF:
 * - entidades disponibles (con tipo_entidad para agrupar)
 * - periodos disponibles (ordenados de mas reciente a mas antiguo)
 */

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { getPlanHistoricoBoundary, requireSession } from "@/lib/auth-helpers";
import { handleRoute } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    const user = await requireSession();

    const [entRows, perRows] = await Promise.all([
      db.execute<{ nomb_correg: string; tipo_entidad: string }>(sql`
        SELECT nomb_correg, tipo_entidad
        FROM (
          SELECT DISTINCT nomb_correg, tipo_entidad
          FROM marts.mv_eeff_resultados_ancho
          WHERE nomb_correg IS NOT NULL
        ) t
        ORDER BY CASE tipo_entidad
                   WHEN 'BANCOS' THEN 1
                   WHEN 'FINANCIERAS' THEN 2
                   WHEN 'CMAC' THEN 3
                   WHEN 'CRAC' THEN 4
                   WHEN 'EDPYMES' THEN 5
                   ELSE 9
                 END,
                 tipo_entidad,
                 nomb_correg
      `),
      db.execute<{ periodo: number }>(sql`
        SELECT DISTINCT periodo
        FROM marts.mv_eeff_resultados_ancho
        ORDER BY periodo DESC
      `),
    ]);

    let periodos = perRows.map((r) => Number(r.periodo));
    // Clip por plan: usa el ultimo periodo publicado como "hoy" y devuelve
    // solo los periodos dentro de la ventana permitida (trial/free = 12m).
    if (periodos.length > 0) {
      const latest = periodos[0]!;
      const earliest = await getPlanHistoricoBoundary(user.id, latest, user.role);
      if (earliest !== null) {
        periodos = periodos.filter((p) => p >= earliest);
      }
    }

    return {
      entidades: entRows.map((r) => ({
        nombCorreg: String(r.nomb_correg),
        tipoEntidad: String(r.tipo_entidad),
      })),
      periodos,
    };
  });
}
