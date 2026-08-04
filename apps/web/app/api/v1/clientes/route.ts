/**
 * GET /api/v1/clientes
 *
 * Lista de clientes activos (slug + nombre) para el dropdown de "cliente
 * default por usuario" en Settings > Mi perfil. Requiere sesion pero no
 * admin — cualquier usuario logueado puede consultar la lista para elegir
 * su default.
 *
 * Response: { rows: [{ slug, nombre, nombreCorto }] }
 */

import { sql } from "drizzle-orm";

import { requireSession } from "@/lib/auth-helpers";
import { db } from "@/lib/infrastructure/db";
import { handleRoute } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    await requireSession();
    const rows = await db.execute<{
      slug: string;
      nombre: string;
      nombre_corto: string | null;
    }>(sql`
      SELECT slug, nombre, nombre_corto
      FROM config.cliente
      WHERE activo
      ORDER BY nombre ASC
    `);
    return {
      rows: rows.map((r) => ({
        slug: r.slug,
        nombre: r.nombre,
        nombreCorto: r.nombre_corto ?? r.nombre,
      })),
    };
  });
}
