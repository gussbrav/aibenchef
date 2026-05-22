import type { Metadata } from "next";

import { AnalisisClient } from "./analisis-client";

export const metadata: Metadata = {
  title: "Analisis Dinamico",
};

export const dynamic = "force-dynamic";

export default function AnalisisPage() {
  return (
    <div className="-mx-4 -my-4">
      <AnalisisClient />
    </div>
  );
}
