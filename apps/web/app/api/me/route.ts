import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }

  return NextResponse.json({
    user: session.user,
    session: {
      expiresAt: session.session.expiresAt,
    },
  });
}
