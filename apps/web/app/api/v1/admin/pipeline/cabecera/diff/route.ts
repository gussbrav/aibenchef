/**
 * GET /api/v1/admin/pipeline/cabecera/diff?tipoEstado=&tipoEntidad=&periodo=&onlyMissing=true
 *
 * Issue #28 — diff entre raw.eeff_observacion y dw.cabecera_maestra.
 */

import { NextRequest } from "next/server";

import { requireAdminSession } from "@/lib/auth-helpers";
import { listCabeceraDiff } from "@/lib/domains/pipeline";
import type { TipoEstado } from "@/lib/domains/pipeline";
import { handleRoute, ValidationError } from "@/lib/domains/shared";

const TIPO_ESTADO_VALIDO: TipoEstado[] = ["balance", "resultados"];

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    await requireAdminSession();
    const sp = req.nextUrl.searchParams;

    const tipoEstadoRaw = sp.get("tipoEstado");
    if (!tipoEstadoRaw || !(TIPO_ESTADO_VALIDO as string[]).includes(tipoEstadoRaw)) {
      throw new ValidationError(
        `tipoEstado debe ser uno de: ${TIPO_ESTADO_VALIDO.join(", ")}`,
        {},
      );
    }
    const tipoEstado = tipoEstadoRaw as TipoEstado;

    const tipoEntidad = sp.get("tipoEntidad")?.trim();
    if (!tipoEntidad) {
      throw new ValidationError("tipoEntidad requerido", {});
    }

    const periodo = Number(sp.get("periodo"));
    if (!Number.isFinite(periodo) || periodo < 200001) {
      throw new ValidationError("periodo invalido", {});
    }

    const onlyMissing = sp.get("onlyMissing") === "true";

    return await listCabeceraDiff(tipoEstado, tipoEntidad, periodo, onlyMissing);
  });
}
