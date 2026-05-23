"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export function NewSheetButton({ variant = "default" }: { variant?: "default" | "cta" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crear = async () => {
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim() }),
      });
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error");
      } else {
        router.push(`/dashboard/sheets/${json.data.id}` as never);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 px-4 h-9 text-sm font-medium rounded-lg transition",
          "bg-brand-600 hover:bg-brand-700 text-white",
        )}
      >
        <Plus className="w-4 h-4" />
        Nueva sheet
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
          onClick={() => !guardando && setOpen(false)}
        >
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900 mb-4">Nueva sheet</h2>
            {error && (
              <div className="mb-3 p-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
                {error}
              </div>
            )}
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre de la sheet"
              className="w-full h-9 px-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && nombre.trim() && crear()}
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Grilla default: 100 filas × 26 columnas (A-Z). Edicion libre + autosave + export XLSX.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={guardando}
                className="px-4 h-9 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={crear}
                disabled={!nombre.trim() || guardando}
                className="px-4 h-9 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded"
              >
                {guardando ? "Creando..." : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
