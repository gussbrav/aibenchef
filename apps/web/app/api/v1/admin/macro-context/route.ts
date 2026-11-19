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

  try {
    const [data, lastRefresh] = await Promise.all([
      listAll({ filter, limit, offset }),
      getLastRefresh(),
    ]);
    return NextResponse.json({ ...data, lastRefresh });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[admin/macro-context] listAll failed:", msg);
    const isMissingTable = msg.includes("gov.macro_context") && msg.includes("does not exist");
    return NextResponse.json(
      {
        rows: [],
        total: 0,
        lastRefresh: null,
        error: msg,
        hint: isMissingTable
          ? "La tabla gov.macro_context no existe. La migration V221 no se aplico. Revisar logs del migrator en EasyPanel (buscar '[migrator]' o '[BOOT] MIGRATOR FAILED')."
          : undefined,
      },
      { status: 500 },
    );
  }
}
