import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import {
  listAll,
  getLastRefresh,
} from "@/lib/domains/governance/macro-context";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const filter = (url.searchParams.get("filter") ?? "vigentes") as
    | "all"
    | "vigentes"
    | "expirados"
    | "pending";
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "50", 10));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10));

  const [data, lastRefresh] = await Promise.all([
    listAll({ filter, limit, offset }),
    getLastRefresh(),
  ]);
  return NextResponse.json({ ...data, lastRefresh });
}
