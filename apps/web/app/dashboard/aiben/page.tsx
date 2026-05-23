import type { Metadata } from "next";

import { AibenClient } from "./aiben-client";

export const metadata: Metadata = { title: "Aiben — Pregunta en lenguaje natural" };
export const dynamic = "force-dynamic";

export default function AibenPage() {
  return <AibenClient />;
}
