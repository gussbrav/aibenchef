"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Code,
  LayoutDashboard,
  NotebookText,
  Sparkles,
  TableProperties,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

const STORAGE_KEY = "aibenchef.welcome.dismissed";

/**
 * Banner de bienvenida — se muestra en /dashboard hasta que el usuario lo cierra.
 * No bloquea, solo orienta. Persiste el dismiss en localStorage.
 */
export function WelcomeBanner({ userName }: { userName: string }) {
  const [dismissed, setDismissed] = useState(true); // start hidden hasta validar storage
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      setDismissed(v === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const cerrar = () => {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* swallow */
    }
  };

  if (!mounted || dismissed) return null;

  const primerNombre = userName.split(" ")[0] || "";

  return (
    <section
      className={cn(
        "relative bg-gradient-to-r from-violet-50 via-fuchsia-50 to-rose-50",
        "border border-violet-200 rounded-xl p-6 overflow-hidden",
      )}
    >
      <button
        type="button"
        onClick={cerrar}
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-700 p-1"
        aria-label="Cerrar"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Bienvenido{primerNombre ? `, ${primerNombre}` : ""} a Aibenchef
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Todo lo que necesitas para analizar la banca peruana, en un solo lugar.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
        <Tile
          href="/dashboard/eeff"
          icon={BarChart3}
          label="Estados Financieros"
          desc="EE.FF. histórico por entidad"
          color="brand"
        />
        <Tile
          href="/dashboard/tableros"
          icon={LayoutDashboard}
          label="Tableros"
          desc="Dashboards multi-widget"
          color="emerald"
        />
        <Tile
          href="/dashboard/analisis"
          icon={TableProperties}
          label="Analisis Dinamico"
          desc="Pivot estilo Excel"
          color="sky"
        />
        <Tile
          href="/dashboard/aiben"
          icon={Sparkles}
          label="Aiben"
          desc="Pregunta en lenguaje natural"
          color="violet"
        />
        <Tile
          href="/dashboard/sql"
          icon={Code}
          label="SQL Workbench"
          desc="Queries ad-hoc con Monaco"
          color="amber"
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white/60 border border-slate-200 rounded-full">
          <kbd className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[10px]">Ctrl K</kbd>
          Buscar lo que sea
        </span>
        <Link
          href="/dashboard/notebooks"
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white/60 border border-slate-200 rounded-full hover:bg-white"
        >
          <NotebookText className="w-3 h-3" />
          Empezar con un notebook
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </section>
  );
}

function Tile({
  href,
  icon: Icon,
  label,
  desc,
  color,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  desc: string;
  color: "brand" | "emerald" | "sky" | "violet" | "amber";
}) {
  return (
    <Link
      href={href as never}
      className="group bg-white/80 hover:bg-white border border-white shadow-sm hover:shadow-md hover:border-slate-200 rounded-lg p-3 transition flex flex-col"
    >
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center mb-2",
          color === "brand" && "bg-brand-100 text-brand-700",
          color === "emerald" && "bg-emerald-100 text-emerald-700",
          color === "sky" && "bg-sky-100 text-sky-700",
          color === "violet" && "bg-violet-100 text-violet-700",
          color === "amber" && "bg-amber-100 text-amber-700",
        )}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-xs font-semibold text-slate-900 group-hover:text-brand-700 transition">
        {label}
      </div>
      <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{desc}</div>
    </Link>
  );
}
