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

  try {
    const data = await listProfiles({ filter, limit, offset });
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[admin/entity-profiles] listProfiles failed:", msg);
    // Si la tabla no existe → migration V220 no aplicada.
    const isMissingTable = msg.includes("gov.entity_profiles") && msg.includes("does not exist");
    return NextResponse.json(
      {
        rows: [],
        total: 0,
        error: msg,
        hint: isMissingTable
          ? "La tabla gov.entity_profiles no existe. La migration V220 no se aplico. Correr pnpm --filter web db:migrate o revisar logs del migrator ([migrator] en logs de EasyPanel)."
          : undefined,
      },
      { status: 500 },
    );
  }
}
