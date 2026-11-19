import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { listProfiles } from "@/lib/domains/governance/entity-profiles";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const filter = (url.searchParams.get("filter") ?? "all") as
    | "all"
    | "verified"
    | "pending";
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "50", 10));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10));

  const data = await listProfiles({ filter, limit, offset });
  return NextResponse.json(data);
}
