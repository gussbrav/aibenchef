import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { refreshMacroContext } from "@/lib/domains/governance/macro-context";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // segundos — el research macro puede tardar

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await refreshMacroContext(`admin:${session.user.email}`);
  const status = result.status === "ok" ? 200 : 500;
  return NextResponse.json(result, { status });
}
