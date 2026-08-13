"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, ChevronDown, Settings } from "lucide-react";
import { authClient } from "@/lib/auth/client";

export function DashboardUserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-800/60 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex w-8 h-8 items-center justify-center rounded-full bg-brand-500/20 text-brand-200 text-xs font-bold border border-brand-400/30">
          {initials || "?"}
        </span>
        <span className="hidden sm:inline text-sm font-medium text-white">{name}</span>
        <ChevronDown className="w-4 h-4 text-slate-300" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5 p-2"
        >
          <div className="px-3 py-2 border-b border-slate-100 mb-1">
            <p className="text-sm font-medium text-slate-900 truncate">{name}</p>
            <p className="text-xs text-slate-500 truncate">{email}</p>
          </div>
          <Link
            href={"/dashboard/settings" as never}
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            role="menuitem"
          >
            <Settings className="w-4 h-4" />
            Configuración
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            role="menuitem"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
