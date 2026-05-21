"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface Props {
  gruposDisponibles: string[];
  topicosDisponibles: string[];
  statusesDisponibles: string[];
  filterActual: {
    grupo?: string;
    topico?: string;
    status?: string;
    anio?: number;
  };
}

export function ArchivosFilters({
  gruposDisponibles,
  topicosDisponibles,
  statusesDisponibles,
  filterActual,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/dashboard/admin/archivos?${params.toString()}` as never);
  }

  function clearAll() {
    router.push("/dashboard/admin/archivos");
  }

  const hayFiltros = Boolean(
    filterActual.grupo || filterActual.topico || filterActual.status || filterActual.anio,
  );

  return (
    <div className="flex flex-wrap items-center gap-3 p-4 bg-white rounded-xl border border-slate-200">
      <FilterSelect
        label="Grupo"
        value={filterActual.grupo}
        options={gruposDisponibles}
        onChange={(v) => update("grupo", v)}
      />
      <FilterSelect
        label="Tópico"
        value={filterActual.topico}
        options={topicosDisponibles}
        onChange={(v) => update("topico", v)}
      />
      <FilterSelect
        label="Status"
        value={filterActual.status}
        options={statusesDisponibles}
        onChange={(v) => update("status", v)}
      />
      <FilterSelect
        label="Año"
        value={filterActual.anio?.toString()}
        options={["2023", "2024", "2025", "2026"]}
        onChange={(v) => update("anio", v)}
      />

      {hayFiltros && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center gap-1 ml-auto text-xs text-slate-600 hover:text-slate-900 hover:underline"
        >
          <X className="w-3 h-3" />
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: string[];
  onChange: (v: string | undefined) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-slate-600 font-medium">{label}:</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={cn(
          "h-9 rounded-md border border-slate-300 bg-white px-3 text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
        )}
      >
        <option value="">— todos —</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
