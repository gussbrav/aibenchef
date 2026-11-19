import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import {
  updateItem,
  deleteItem,
  verifyItem,
} from "@/lib/domains/governance/macro-context";
import type { MacroSeveridad } from "@/lib/domains/governance/macro-context";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    titulo?: string;
    resumen?: string;
    impacto?: string | null;
    severidad?: MacroSeveridad;
    vigenteHasta?: string | null;
    verify?: boolean;
  };

  await updateItem({
    id,
    titulo: body.titulo,
    resumen: body.resumen,
    impacto: body.impacto,
    severidad: body.severidad,
    vigenteHasta: body.vigenteHasta,
  });
  if (body.verify) {
    await verifyItem({ id, verifiedBy: session.user.email });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  await deleteItem(id);
  return NextResponse.json({ ok: true });
}
