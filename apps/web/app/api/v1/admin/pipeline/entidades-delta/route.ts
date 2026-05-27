/**
 * GET /api/v1/admin/pipeline/entidades-delta
 *
 * Lista entidades nuevas o desaparecidas en el ultimo periodo comparado
 * con el anterior. Lee marts.v_entidades_delta.
 *
 * Si en_maestra=true → rename ya canonizado en dw.entidad_nombre (no alerta).
 * Si en_maestra=false → requiere accion del operador.
 */

import { requireAdminSession } from "@/lib/auth-helpers";
import { listEntidadesDelta } from "@/lib/domains/pipeline";
import { handleRoute } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    await requireAdminSession();
    return await listEntidadesDelta();
  });
}
