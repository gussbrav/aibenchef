/**
 * GET /api/v1/publicaciones
 *   Lista publicaciones del usuario actual (o de todos si es admin — TODO).
 *   Query params:
 *     - status: csv de status a filtrar (default: no archived)
 *     - limit: int (default 100)
 *
 * Response: { publicaciones: PublicacionListItem[] }
 */

import type { NextRequest } from "next/server";

import { requireSession } from "@/lib/auth-helpers";
import { handleRoute } from "@/lib/domains/shared";
import {
  listPublicaciones,
  PUBLICACION_STATUS,
  type PublicacionStatus,
} from "@/lib/domains/publicaciones";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const session = await requireSession();
    const url = new URL(req.url);
    const statusCsv = url.searchParams.get("status");
    const limitStr = url.searchParams.get("limit");

    const status = statusCsv
      ? (statusCsv
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is PublicacionStatus =>
            PUBLICACION_STATUS.includes(s as PublicacionStatus),
          ))
      : undefined;
    const limit = limitStr ? Math.min(Number.parseInt(limitStr, 10) || 100, 500) : 100;

    const publicaciones = await listPublicaciones({
      createdBy: `user:${session.email}`,
      status,
      limit,
    });
    return { publicaciones };
  });
}
