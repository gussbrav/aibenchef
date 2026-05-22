import type { Metadata } from "next";

import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Configuracion" };
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <SettingsClient />;
}
