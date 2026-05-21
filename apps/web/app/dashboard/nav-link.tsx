"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/utils/cn";

interface NavLinkProps {
  href: Route;
  label: string;
  /**
   * Si true, el link se marca como activo solo cuando el pathname matchea
   * EXACTO. Si false (default), tambien matchea sub-rutas (ej /dashboard
   * matchearia /dashboard/eeff). Util para tab del "Resumen" que no quiere
   * activarse en sub-paginas.
   */
  exact?: boolean;
}

export function NavLink({ href, label, exact = false }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={cn(
        "relative h-16 inline-flex items-center text-sm transition-colors",
        isActive
          ? "text-slate-900 font-semibold"
          : "text-slate-600 hover:text-slate-900",
      )}
      aria-current={isActive ? "page" : undefined}
    >
      {label}
      {isActive && (
        <span
          aria-hidden
          className="absolute inset-x-0 -bottom-px h-0.5 bg-brand-600 rounded-full"
        />
      )}
    </Link>
  );
}
