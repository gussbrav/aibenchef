import Link from "next/link";
import type { Metadata } from "next";

import { Nav as MarketingNav } from "@/components/marketing/nav";

export const metadata: Metadata = {
  title: "Documentación",
};

/**
 * Layout de /docs — usa el mismo header del marketing publico + un
 * sidebar simple con links a las secciones (API + MCP por ahora).
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingNav />
      <div className="max-w-6xl mx-auto px-4 py-10 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8">
        <aside className="md:sticky md:top-24 md:self-start space-y-1 text-sm">
          <p className="text-[11px] uppercase tracking-widest font-semibold text-slate-500 mb-2 px-2">
            Documentación
          </p>
          <Link
            href={"/docs/api" as never}
            className="block px-3 py-2 rounded-md hover:bg-white text-slate-700 hover:text-slate-900"
          >
            API pública REST
          </Link>
          <Link
            href={"/docs/mcp" as never}
            className="block px-3 py-2 rounded-md hover:bg-white text-slate-700 hover:text-slate-900"
          >
            MCP para Claude Desktop
          </Link>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
