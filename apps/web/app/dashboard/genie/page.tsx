import type { Metadata } from "next";

import { GenieClient } from "./genie-client";

export const metadata: Metadata = { title: "Genie — NL a SQL" };
export const dynamic = "force-dynamic";

export default function GeniePage() {
  return <GenieClient />;
}
