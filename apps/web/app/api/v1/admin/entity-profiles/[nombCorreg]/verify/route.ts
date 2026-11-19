import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { verifyProfile } from "@/lib/domains/governance/entity-profiles";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ nombCorreg: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { nombCorreg } = await ctx.params;
  const decoded = decodeURIComponent(nombCorreg);
  await verifyProfile({ nombCorreg: decoded, verifiedBy: session.user.email });
  return NextResponse.json({ ok: true });
}
