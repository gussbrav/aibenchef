import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/components/ui";

import { GovernanceClient } from "./governance-client";

export const metadata: Metadata = {
  title: "Data Governance",
};

export const dynamic = "force-dynamic";

export default function GovernancePage() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto px-2">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Data Governance</h1>
        <p className="text-sm text-slate-600 mt-1">
          Audit log, business glossary, lineage, tenancy, column tags.
          Ver{" "}
          <Link
            href={"/docs/adr/005-data-governance-architecture" as never}
            className="underline text-violet-700 hover:text-violet-900"
          >
            ADR 005
          </Link>
          .
        </p>
      </header>

      <Card>
        <GovernanceClient />
      </Card>
    </div>
  );
}
