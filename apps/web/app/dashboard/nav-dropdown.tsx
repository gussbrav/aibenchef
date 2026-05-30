"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Route } from "next";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type NavDropdownItem = {
  href: string;
  label: string;
  /** Texto pequeño descriptivo opcional (visible solo en el dropdown). */
  description?: string;
};

/**
 * NavDropdown — agrupa varios items de navegacion en un menu colapsable.
 * Se marca activo si el pathname matchea cualquiera de los hrefs hijos.
 * Cierra al click afuera o al cambiar de ruta.
 */
export function NavDropdown({ label, items }: { label: string; items: NavDropdownItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isActive = items.some(
    (it) => pathname === it.href || pathname.startsWith(`${it.href}/`),
  );

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative h-14 flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "h-14 inline-flex items-center gap-1 transition-colors",
          isActive
            ? "text-slate-900 font-semibold"
            : "text-slate-600 hover:text-slate-900",
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
        {isActive && (
          <span
            aria-hidden
            className="absolute inset-x-0 -bottom-px h-0.5 bg-brand-600 rounded-full"
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-1 w-64 rounded-lg border border-slate-200 bg-white shadow-lg ring-1 ring-black/5 z-50 overflow-hidden"
        >
          {items.map((it) => {
            const itemActive =
              pathname === it.href || pathname.startsWith(`${it.href}/`);
            return (
              <Link
                key={it.href}
                href={it.href as Route}
                role="menuitem"
                className={cn(
                  "block px-4 py-2.5 text-sm border-b border-slate-100 last:border-b-0 transition-colors",
                  itemActive
                    ? "bg-brand-50 text-brand-900 font-semibold"
                    : "text-slate-700 hover:bg-slate-50",
                )}
              >
                <div>{it.label}</div>
                {it.description && (
                  <div className="text-[11px] text-slate-500 mt-0.5">{it.description}</div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
