import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getSheet } from "@/lib/domains/sheets";

import { SheetEditor } from "./sheet-editor";

export const metadata: Metadata = { title: "Sheet" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function SheetPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const { id } = await params;
  let sheet;
  try {
    sheet = await getSheet(session.user.id, id);
  } catch {
    notFound();
  }
  return <SheetEditor sheet={sheet} />;
}
