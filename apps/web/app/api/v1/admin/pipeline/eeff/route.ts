/**
 * GET /api/v1/admin/pipeline/eeff?entidad=X&periodo=YYYYMM&moneda=TOTAL
 *
 * EEFF Inspector — devuelve BG + ER de una entidad+periodo con jerarquia,
 * delta vs periodo previo, match contra cabecera_maestra y badges de quality.
 *
 * Issue #26.
 */

import { NextRequest } from "next/server";

import { requireAdminSession } from "@/lib/auth-helpers";
import { getEeffInspectorData } from "@/lib/domains/pipeline";
import type { Moneda } from "@/lib/domains/pipeline";
import { handleRoute, NotFoundError, ValidationError } from "@/lib/domains/shared";

const MONEDA_VALIDA: Moneda[] = ["MN", "ME", "TOTAL"];

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await requireAdminSession();
    const sp = req.nextUrl.searchParams;

    const entidad = sp.get("entidad")?.trim();
    if (!entidad) {
      throw new ValidationError("entidad es requerida", {});
    }

    const periodoRaw = sp.get("periodo");
    const periodo = Number(periodoRaw);
    if (!Number.isFinite(periodo) || periodo < 200001) {
      throw new ValidationError("periodo debe ser YYYYMM valido", {});
    }

    const monedaRaw = (sp.get("moneda") ?? "TOTAL").toUpperCase();
    if (!(MONEDA_VALIDA as string[]).includes(monedaRaw)) {
      throw new ValidationError(
        `moneda debe ser una de: ${MONEDA_VALIDA.join(", ")}`,
        {},
      );
    }
    const moneda = monedaRaw as Moneda;

    const data = await getEeffInspectorData(entidad, periodo, moneda);
    if (!data) {
      throw new NotFoundError(
        `No hay data para entidad='${entidad}' en periodo=${periodo}`,
        {},
      );
    }
    return data;
  });
}
