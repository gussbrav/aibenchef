import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { db } from "@/lib/infrastructure/db";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/v1/admin/entity-profiles/:nombCorreg
 * Edicion manual del perfil. Marca automaticamente verified_by_human = true
 * porque el admin esta editando a mano. Null = limpiar campo; undefined = dejar igual.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ nombCorreg: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { nombCorreg } = await ctx.params;
  const decoded = decodeURIComponent(nombCorreg);
  const body = (await req.json()) as {
    ubicacion?: string | null;
    inicioOperaciones?: string | null;
    rucSunat?: string | null;
    publicoObjetivo?: string | null;
    modeloNegocio?: "cerrada" | "abierta" | "mixta" | "desconocido" | null;
    segmentoCarteraHipotesis?: string | null;
    productosPrincipales?: string | null;
    notas?: string | null;
  };

  const maybe = <T>(value: T | undefined, fallback: ReturnType<typeof sql>) =>
    value === undefined ? fallback : sql`${value}::text`;

  await db.execute(sql`
    UPDATE gov.entity_profiles
       SET ubicacion                   = ${maybe(body.ubicacion, sql`ubicacion`)},
           inicio_operaciones          = ${maybe(body.inicioOperaciones, sql`inicio_operaciones`)},
           ruc_sunat                   = ${maybe(body.rucSunat, sql`ruc_sunat`)},
           publico_objetivo            = ${maybe(body.publicoObjetivo, sql`publico_objetivo`)},
           modelo_negocio              = ${maybe(body.modeloNegocio, sql`modelo_negocio`)},
           segmento_cartera_hipotesis  = ${maybe(body.segmentoCarteraHipotesis, sql`segmento_cartera_hipotesis`)},
           productos_principales       = ${maybe(body.productosPrincipales, sql`productos_principales`)},
           notas                       = ${maybe(body.notas, sql`notas`)},
           verified_by_human           = true,
           verified_by                 = ${session.user.email},
           verified_at                 = now()
     WHERE nomb_correg = ${decoded}
  `);
  return NextResponse.json({ ok: true });
}
