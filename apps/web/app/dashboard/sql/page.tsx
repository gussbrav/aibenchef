import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { SqlWorkbenchClient } from "./sql-workbench-client";

export const metadata: Metadata = {
  title: "SQL Workbench",
};

export const dynamic = "force-dynamic";

export default async function SqlWorkbenchPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (!(await isAdmin(session.user.id))) redirect("/dashboard");
  return (
    <div className="-mx-4 -my-4">
      <SqlWorkbenchClient />
    </div>
  );
}
