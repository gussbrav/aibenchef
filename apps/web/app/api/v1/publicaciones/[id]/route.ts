/**
 * GET    /api/v1/publicaciones/[id]  -> detalle
 * PATCH  /api/v1/publicaciones/[id]  -> update titulo/contenidoMd/hashtags/status
 * DELETE /api/v1/publicaciones/[id]  -> soft delete (status = archived)
 *
 * Autorizacion: solo el creador puede editar/borrar su publicacion.
 */

import type { NextRequest } from "next/server";

import { requireSession } from "@/lib/auth-helpers";
import { handleRoute, ValidationError } from "@/lib/domains/shared";
import {
  archivePublicacion,
  getPublicacion,
  PublicacionesError,
  updatePublicacion,
  PUBLICACION_STATUS,
  type PublicacionStatus,
} from "@/lib/domains/publicaciones";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function ensureOwner(id: string, userEmail: string) {
  const pub = await getPublicacion(id);
  if (!pub) {
    throw new PublicacionesError("Publicacion no encontrada", "not_found");
  }
  if (pub.createdBy !== `user:${userEmail}`) {
    throw new PublicacionesError(
      "No podes editar una publicacion de otro usuario",
      "forbidden",
    );
  }
  return pub;
}

export async function GET(_req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const session = await requireSession();
    const { id } = await params;
    const pub = await ensureOwner(id, session.email);
    return { publicacion: pub };
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const session = await requireSession();
    const { id } = await params;
    await ensureOwner(id, session.email);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      throw new ValidationError("body invalido (no es JSON)");
    }

    const updates: Parameters<typeof updatePublicacion>[1] = {};
    if (typeof body.titulo === "string") updates.titulo = body.titulo;
    if (typeof body.contenidoMd === "string") updates.contenidoMd = body.contenidoMd;
    if (Array.isArray(body.hashtags)) {
      updates.hashtags = body.hashtags.filter(
        (h): h is string => typeof h === "string",
      );
    }
    if (typeof body.status === "string") {
      if (!PUBLICACION_STATUS.includes(body.status as PublicacionStatus)) {
        throw new ValidationError(
          `status invalido. Validos: ${PUBLICACION_STATUS.join(", ")}`,
        );
      }
      updates.status = body.status as PublicacionStatus;
      if (updates.status === "published") {
        updates.publishedBy = `user:${session.email}`;
      }
    }

    const publicacion = await updatePublicacion(id, updates);
    return { publicacion };
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const session = await requireSession();
    const { id } = await params;
    await ensureOwner(id, session.email);
    await archivePublicacion(id);
    return { ok: true };
  });
}
