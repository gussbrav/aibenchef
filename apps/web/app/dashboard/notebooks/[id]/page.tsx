import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getNotebook } from "@/lib/domains/notebooks";

import { NotebookEditor } from "./notebook-editor";

export const metadata: Metadata = { title: "Notebook" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function NotebookPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const { id } = await params;
  let notebook;
  try {
    notebook = await getNotebook(session.user.id, id);
  } catch {
    notFound();
  }
  return <NotebookEditor notebook={notebook} />;
}
