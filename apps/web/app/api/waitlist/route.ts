import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Endpoint stub. En Fase 4 integramos con Resend + tabla `tenant.waitlist`.
// Por ahora solo logueamos y redirigimos.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = (form.get("email") ?? "").toString().trim();
  const org = (form.get("org") ?? "").toString().trim();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "email invalido" }, { status: 400 });
  }

  console.log("[waitlist]", { email, org, ts: new Date().toISOString() });

  // TODO Fase 4: insertar en tenant.waitlist + Resend confirmation email.
  return NextResponse.redirect(new URL("/waitlist?ok=1", req.url), 303);
}
