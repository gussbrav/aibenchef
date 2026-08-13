"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/utils/cn";

interface NavLinkProps {
  // Permitimos string para que rutas recientes (que aun no estan en el
  // RouteType generado de Next) compilen. La validacion la hace Next en runtime.
  href: Route | string;
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
      href={href as Route}
      className={cn(
        "relative h-14 inline-flex items-center transition-colors",
        isActive
          ? "text-white font-semibold"
          : "text-slate-300 hover:text-white",
      )}
      aria-current={isActive ? "page" : undefined}
    >
      {label}
      {isActive && (
        <span
          aria-hidden
          className="absolute inset-x-0 -bottom-px h-0.5 bg-brand-400 rounded-full"
        />
      )}
    </Link>
  );
}
