"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, BarChart3, GitBranch, TrendingUp, FileText } from "lucide-react";
import { Container, Button } from "@/components/ui";

/**
 * Nav publica del landing. Dropdown "Producto" lista los 4 modulos con
 * icono + descripcion + link a la demo publica correspondiente.
 * Cerrado por default, se abre al hover en desktop y al click en mobile.
 */

const productoItems = [
  {
    icon: BarChart3,
    title: "Informe / Benchmark",
    description: "Cuadro resumen con heatmap del peer group",
    href: "/demo/informe",
  },
  {
    icon: GitBranch,
    title: "DuPont",
    description: "Árbol ROE con lectura editorial AI",
    href: "/demo/dupont",
  },
  {
    icon: TrendingUp,
    title: "Punto de Equilibrio",
    description: "Rendimiento mínimo histórico",
    href: "/demo/punto-equilibrio",
  },
  {
    icon: FileText,
    title: "Publicaciones",
    description: "Artículos con gráficos AI para LinkedIn",
    href: "/demo/publicaciones",
  },
];

export function Nav() {
  const [productoOpen, setProductoOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full backdrop-blur-md bg-white/80 border-b border-slate-200/50">
      <Container size="xl">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-sm">
              A
            </div>
            <span className="font-bold text-slate-900">Aibenchef</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1 text-sm text-slate-600">
            {/* Producto — dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setProductoOpen(true)}
              onMouseLeave={() => setProductoOpen(false)}
            >
              <button
                type="button"
                onClick={() => setProductoOpen((v) => !v)}
                className="flex items-center gap-1 px-3 py-2 hover:text-slate-900 transition-colors"
                aria-expanded={productoOpen}
              >
                Producto
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${productoOpen ? "rotate-180" : ""}`} />
              </button>
              {productoOpen && (
                <div className="absolute left-0 top-full pt-2">
                  <div className="w-[420px] bg-white rounded-xl border border-slate-200 shadow-xl p-2">
                    {productoItems.map(({ icon: Icon, title, description, href }) => (
                      <Link
                        key={href}
                        href={href as never}
                        className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors group/item"
                      >
                        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center group-hover/item:bg-brand-100 transition-colors">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">{title}</p>
                          <p className="text-xs text-slate-500 leading-snug mt-0.5">{description}</p>
                        </div>
                      </Link>
                    ))}
                    <div className="mt-1 pt-2 border-t border-slate-100">
                      <Link
                        href="/#modulos"
                        className="block px-3 py-2 text-xs font-medium text-brand-700 hover:text-brand-800"
                      >
                        Ver todos los módulos →
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Link href="/#comparativa" className="px-3 py-2 hover:text-slate-900 transition-colors">
              Comparativa
            </Link>
            <Link href="/#planes" className="px-3 py-2 hover:text-slate-900 transition-colors">
              Planes
            </Link>
            <Link href="/#faq" className="px-3 py-2 hover:text-slate-900 transition-colors">
              FAQ
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden sm:inline-flex items-center text-sm text-slate-700 hover:text-slate-900 font-medium px-3 py-2"
            >
              Entrar
            </Link>
            <Link href={"/solicitar-acceso" as never}>
              <Button size="sm">Solicitar acceso</Button>
            </Link>
          </div>
        </div>
      </Container>
    </header>
  );
}
