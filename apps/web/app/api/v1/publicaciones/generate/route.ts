/**
 * POST /api/v1/publicaciones/generate
 *
 * Body: {
 *   tema: PublicacionTema,
 *   clienteSlug: string,
 *   entidadPropia: string,
 *   peerGroup: string[],
 *   periodo: number,
 *   eventosMacro?: string  // solo coyuntura_macro
 * }
 *
 * El endpoint construye el contexto server-side (via buildContextoForTema)
 * consultando las MV apropiadas. El cliente NO tiene que armar el contexto.
 *
 * Response: { publicacion: Publicacion }
 */

import type { NextRequest } from "next/server";

import { requireSession } from "@/lib/auth-helpers";
import { handleRoute, ValidationError, ConflictError, RateLimitError } from "@/lib/domains/shared";
import {
  generatePublicacion,
  PublicacionesError,
  PUBLICACION_TEMAS,
  type PublicacionTema,
} from "@/lib/domains/publicaciones";
import { buildContextoForTema } from "@/lib/domains/publicaciones/contexto";

export const dynamic = "force-dynamic";

type Body = {
  tema?: string;
  clienteSlug?: string;
  entidadPropia?: string;
  peerGroup?: unknown;
  periodo?: unknown;
  eventosMacro?: unknown;
  mesesAtras?: unknown;
  aniosAtras?: unknown;
};

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const session = await requireSession();
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      throw new ValidationError("body invalido (no es JSON)");
    }

    if (!body.tema || !PUBLICACION_TEMAS.includes(body.tema as PublicacionTema)) {
      throw new ValidationError(
        `tema invalido. Validos: ${PUBLICACION_TEMAS.join(", ")}`,
      );
    }
    if (!body.clienteSlug) throw new ValidationError("clienteSlug requerido");
    if (!body.entidadPropia) throw new ValidationError("entidadPropia requerida");
    if (!Array.isArray(body.peerGroup)) {
      throw new ValidationError("peerGroup requerido (array, puede ser vacio)");
    }
    // peerGroup vacio permitido — articulo mono-entidad sin comparativa.
    if (typeof body.periodo !== "number" || Number.isNaN(body.periodo)) {
      throw new ValidationError("periodo requerido (number YYYYMM)");
    }
    const peerGroup = (body.peerGroup as unknown[]).filter(
      (x): x is string => typeof x === "string",
    );

    try {
      // 1. Armar contexto server-side (consulta las MV segun el tema).
      //    Los temas "visuales" tambien devuelven charts SVG pre-generados
      //    que se persisten con la publicacion.
      const { contexto, charts } = await buildContextoForTema({
        tema: body.tema as PublicacionTema,
        clienteSlug: body.clienteSlug,
        entidadPropia: body.entidadPropia,
        peerGroup,
        periodo: body.periodo,
        eventosMacro:
          typeof body.eventosMacro === "string" ? body.eventosMacro : undefined,
        mesesAtras:
          typeof body.mesesAtras === "number" && Number.isFinite(body.mesesAtras)
            ? Math.max(6, Math.min(120, body.mesesAtras))
            : undefined,
        aniosAtras:
          typeof body.aniosAtras === "number" && Number.isFinite(body.aniosAtras)
            ? Math.max(2, Math.min(15, body.aniosAtras))
            : undefined,
      });

      // 2. Generar articulo con el LLM.
      const publicacion = await generatePublicacion(
        {
          tema: body.tema as PublicacionTema,
          clienteSlug: body.clienteSlug,
          entidadPropia: body.entidadPropia,
          peerGroup,
          periodo: body.periodo,
          contexto,
          charts,
        },
        { email: session.email },
      );

      return { publicacion };
    } catch (err) {
      if (err instanceof PublicacionesError) {
        if (err.code === "rate_limit") {
          throw new RateLimitError(err.message, err.details ?? {});
        }
        if (err.code === "no_provider") {
          throw new ConflictError(err.message, {
            hint: "Habilita un proveedor en /dashboard/settings > Proveedores AI",
          });
        }
        throw new ConflictError(err.message, err.details ?? {});
      }
      throw err;
    }
  });
}
