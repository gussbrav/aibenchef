import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { AibenClient } from "./aiben-client";

export const metadata: Metadata = { title: "Aiben — Pregunta en lenguaje natural" };
export const dynamic = "force-dynamic";

// Temporal: solo admin puede acceder mientras estabilizamos calidad de
// respuestas y definimos el scope final. La opcion de menu en el layout
// tambien esta oculta. Cuando la feature este lista para usuarios finales,
// remover este gate y reactivar el item del menu.
export default async function AibenPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (!(await isAdmin(session.user.id))) redirect("/dashboard");
  return <AibenClient />;
}
