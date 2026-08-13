import type { NextRequest } from "next/server";

import { withApiPublic } from "@/lib/api-public/middleware";
import { listEntidadesDisponibles } from "@/lib/domains/informe/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/v1/entidades[?tipo=BANCOS]
 *
 * Devuelve el catalogo de entidades reguladas activas. Sin tipo, devuelve
 * todas. Con tipo, filtra por grupo regulatorio:
 *   BANCOS | FINANCIERAS | CMAC | CRAC | EDPYMES
 *
 * Response:
 *   { data: [{ nombCorreg, tipoEntidad, microfinanciera, ultimoPeriodo }, ...] }
 */
export async function GET(req: NextRequest) {
  return withApiPublic(req, async () => {
    const url = new URL(req.url);
    const tipo = url.searchParams.get("tipo")?.toUpperCase();
    const all = await listEntidadesDisponibles({});
    if (!tipo) return all;
    return all.filter((e) => e.tipoEntidad?.toUpperCase() === tipo);
  });
}
