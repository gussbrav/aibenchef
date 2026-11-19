import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import {
  researchEntityProfile,
  ResearchError,
} from "@/lib/domains/governance/entity-profiles";
import { upsertEntityProfileFromResearch } from "@/lib/domains/governance/entity-profiles/repository";

export const dynamic = "force-dynamic";

export async function POST(
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

  let tipoEntidad: string | null = null;
  try {
    const body = (await req.json()) as { tipoEntidad?: string };
    tipoEntidad = body.tipoEntidad ?? null;
  } catch {
    // body opcional
  }

  try {
    const result = await researchEntityProfile({ nombCorreg: decoded, tipoEntidad });
    const saved = await upsertEntityProfileFromResearch({
      nombCorreg: decoded,
      tipoEntidad,
      ubicacion: result.profile.ubicacion,
      region: result.profile.region,
      inicioOperaciones: result.profile.inicioOperaciones,
      rucSunat: result.profile.rucSunat,
      publicoObjetivo: result.profile.publicoObjetivo,
      modeloNegocio: result.profile.modeloNegocio,
      segmentoCarteraHipotesis: result.profile.segmentoCarteraHipotesis,
      productosPrincipales: result.profile.productosPrincipales,
      notas: result.profile.notas,
      fuentes: result.profile.fuentes,
      researchModel: result.metadata.model,
      researchCostUsd: result.metadata.costUsd,
    });
    return NextResponse.json({ ok: true, profile: saved, cost: result.metadata.costUsd });
  } catch (err) {
    if (err instanceof ResearchError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.code === "no_api_key" ? 400 : 500 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
