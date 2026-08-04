import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/domains/users";
import { CatalogClient } from "./catalog-client";

export const metadata: Metadata = {
  title: "Catalog",
};

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  if (!(await isAdmin(session.user.id))) redirect("/dashboard");
  return (
    <div className="-mx-4 -my-4">
      <CatalogClient />
    </div>
  );
}
