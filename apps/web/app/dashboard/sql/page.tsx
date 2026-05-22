import type { Metadata } from "next";

import { SqlWorkbenchClient } from "./sql-workbench-client";

export const metadata: Metadata = {
  title: "SQL Workbench",
};

export const dynamic = "force-dynamic";

export default function SqlWorkbenchPage() {
  return (
    <div className="-mx-4 -my-4">
      <SqlWorkbenchClient />
    </div>
  );
}
