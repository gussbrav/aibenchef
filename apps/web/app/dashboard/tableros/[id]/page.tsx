import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getTablero } from "@/lib/domains/tableros";

import { TableroEditor } from "./tablero-editor";

export const metadata: Metadata = { title: "Tablero" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function TableroPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const { id } = await params;

  let tablero;
  try {
    tablero = await getTablero(session.user.id, id);
  } catch {
    notFound();
  }

  return <TableroEditor tablero={tablero} />;
}
