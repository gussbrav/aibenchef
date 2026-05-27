/**
 * GET /api/v1/admin/pipeline/cobertura?periodo=YYYYMM
 *
 * Cobertura por (tópico, grupo) del periodo solicitado:
 *   - total de archivos esperados
 *   - cuántos procesados / errores / pendientes / no publicados
 *   - % completado
 *
 * Si no se pasa periodo, usa el ultimo periodo con archivos descargados.
 */

import { NextRequest } from "next/server";

import { requireAdminSession } from "@/lib/auth-helpers";
import {
  getCobertura,
  getUltimoPeriodoConArchivos,
} from "@/lib/domains/pipeline";
import { handleRoute, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await requireAdminSession();
    const sp = req.nextUrl.searchParams;

    let periodo: number | null = null;
    const periodoRaw = sp.get("periodo");
    if (periodoRaw) {
      const n = Number(periodoRaw);
      if (!Number.isFinite(n) || n < 200001 || n > 209912) {
        throw new ValidationError("periodo debe ser YYYYMM valido", {});
      }
      periodo = n;
    } else {
      periodo = await getUltimoPeriodoConArchivos();
    }

    if (periodo == null) {
      return { periodo: null, filas: [] };
    }

    const filas = await getCobertura(periodo);
    return { periodo, filas };
  });
}
