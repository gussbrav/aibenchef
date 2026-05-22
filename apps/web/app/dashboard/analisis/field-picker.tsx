"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { tipoEntidadLabel, TIPO_ENTIDAD_ORDER } from "@/app/dashboard/_lib/format";

import type {
  ColumnasDisponibles,
  FuentePivot,
  PivotConfig,
  PivotColumna,
  AgregacionPivot,
  Moneda,
} from "./types";

const TIPOS_ENTIDAD_OPCIONES = ["BANCOS", "FINANCIERAS", "CMAC", "CRAC", "EDPYMES"].sort(
  (a, b) => (TIPO_ENTIDAD_ORDER[a] ?? 99) - (TIPO_ENTIDAD_ORDER[b] ?? 99),
);

const MONEDAS_OPCIONES: Moneda[] = ["TOTAL", "MN", "ME"];
const AGREGACIONES: { value: AgregacionPivot; label: string }[] = [
  { value: "NONE", label: "Sin agregacion (detalle)" },
  { value: "SUM", label: "Suma" },
  { value: "AVG", label: "Promedio" },
  { value: "MIN", label: "Minimo" },
  { value: "MAX", label: "Maximo" },
  { value: "COUNT", label: "Conteo" },
];

const FUENTES: { value: FuentePivot; label: string }[] = [
  { value: "balance", label: "Balance General" },
  { value: "resultados", label: "Estado de Resultados" },
  { value: "ratios", label: "Ratios" },
];

export function FieldPicker({
  config,
  columnas,
  loading,
  onChange,
  onEjecutar,
  onGuardar,
}: {
  config: PivotConfig;
  columnas: ColumnasDisponibles | null;
  loading: boolean;
  onChange: (next: PivotConfig) => void;
  onEjecutar: () => void;
  onGuardar: () => void;
}) {
  const [search, setSearch] = useState("");
  const [openSection, setOpenSection] = useState<{
    dim: boolean;
    med: boolean;
    fil: boolean;
  }>({ dim: true, med: true, fil: true });

  const filterCols = (cols: PivotColumna[]) => {
    if (!search.trim()) return cols;
    const q = search.toLowerCase();
    return cols.filter(
      (c) => c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q),
    );
  };

  const dimsDisp = useMemo(
    () => (columnas ? filterCols(columnas.dimensiones) : []),
    [columnas, search],
  );
  const medsDisp = useMemo(
    () => (columnas ? filterCols(columnas.medidas) : []),
    [columnas, search],
  );

  const toggleArray = (arr: string[], key: string): string[] =>
    arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key];

  return (
    <aside className="w-72 flex-shrink-0 border-r border-slate-200 bg-white flex flex-col h-full">
      <div className="p-3 border-b border-slate-200 space-y-2">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Fuente
          </label>
          <select
            value={config.fuente}
            onChange={(e) =>
              onChange({ ...config, fuente: e.target.value as FuentePivot })
            }
            className="w-full h-8 px-2 text-xs rounded border border-slate-300 bg-white"
          >
            {FUENTES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Agregacion
          </label>
          <select
            value={config.agregacion}
            onChange={(e) =>
              onChange({ ...config, agregacion: e.target.value as AgregacionPivot })
            }
            className="w-full h-8 px-2 text-xs rounded border border-slate-300 bg-white"
          >
            {AGREGACIONES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1 bg-slate-50 rounded px-2 h-8 border border-slate-200">
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar campo..."
            className="flex-1 bg-transparent text-xs outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Dimensiones */}
        <Section
          title="Dimensiones"
          count={config.dimensiones.length}
          total={columnas?.dimensiones.length ?? 0}
          isOpen={openSection.dim}
          toggle={() => setOpenSection((s) => ({ ...s, dim: !s.dim }))}
        >
          {dimsDisp.map((c) => {
            const checked = config.dimensiones.includes(c.key);
            return (
              <CheckboxRow
                key={c.key}
                label={c.label}
                checked={checked}
                onChange={() =>
                  onChange({
                    ...config,
                    dimensiones: toggleArray(config.dimensiones, c.key),
                  })
                }
              />
            );
          })}
        </Section>

        {/* Medidas */}
        <Section
          title="Medidas"
          count={config.medidas.length}
          total={columnas?.medidas.length ?? 0}
          isOpen={openSection.med}
          toggle={() => setOpenSection((s) => ({ ...s, med: !s.med }))}
        >
          {medsDisp.map((c) => {
            const checked = config.medidas.includes(c.key);
            return (
              <CheckboxRow
                key={c.key}
                label={c.label}
                checked={checked}
                onChange={() =>
                  onChange({
                    ...config,
                    medidas: toggleArray(config.medidas, c.key),
                  })
                }
              />
            );
          })}
        </Section>

        {/* Filtros */}
        <Section
          title="Filtros"
          count={
            (config.filtros.tipoEntidad?.length ?? 0) +
            (config.filtros.moneda?.length ?? 0) +
            (config.filtros.periodoDesde ? 1 : 0) +
            (config.filtros.periodoHasta ? 1 : 0)
          }
          total={null}
          isOpen={openSection.fil}
          toggle={() => setOpenSection((s) => ({ ...s, fil: !s.fil }))}
        >
          <div className="px-3 pb-3 space-y-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Tipo entidad
              </label>
              <div className="flex flex-wrap gap-1">
                {TIPOS_ENTIDAD_OPCIONES.map((te) => {
                  const active = config.filtros.tipoEntidad?.includes(te) ?? false;
                  return (
                    <button
                      key={te}
                      type="button"
                      onClick={() =>
                        onChange({
                          ...config,
                          filtros: {
                            ...config.filtros,
                            tipoEntidad: toggleArray(
                              config.filtros.tipoEntidad ?? [],
                              te,
                            ),
                          },
                        })
                      }
                      className={cn(
                        "px-2 py-1 text-[10px] rounded border transition-colors",
                        active
                          ? "bg-brand-600 text-white border-brand-600"
                          : "bg-white text-slate-600 border-slate-300 hover:border-slate-400",
                      )}
                    >
                      {tipoEntidadLabel(te)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Moneda
              </label>
              <div className="flex gap-1">
                {MONEDAS_OPCIONES.map((m) => {
                  const active = config.filtros.moneda?.includes(m) ?? false;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        onChange({
                          ...config,
                          filtros: {
                            ...config.filtros,
                            moneda: toggleArray(config.filtros.moneda ?? [], m) as Moneda[],
                          },
                        })
                      }
                      className={cn(
                        "px-2 py-1 text-[10px] rounded border flex-1",
                        active
                          ? "bg-brand-600 text-white border-brand-600"
                          : "bg-white text-slate-600 border-slate-300",
                      )}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Periodo desde
                </label>
                <input
                  type="number"
                  value={config.filtros.periodoDesde ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...config,
                      filtros: {
                        ...config.filtros,
                        periodoDesde: e.target.value
                          ? Number.parseInt(e.target.value)
                          : undefined,
                      },
                    })
                  }
                  placeholder="202401"
                  className="w-full h-8 px-2 text-xs rounded border border-slate-300 tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Hasta
                </label>
                <input
                  type="number"
                  value={config.filtros.periodoHasta ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...config,
                      filtros: {
                        ...config.filtros,
                        periodoHasta: e.target.value
                          ? Number.parseInt(e.target.value)
                          : undefined,
                      },
                    })
                  }
                  placeholder="202603"
                  className="w-full h-8 px-2 text-xs rounded border border-slate-300 tabular-nums"
                />
              </div>
            </div>
          </div>
        </Section>
      </div>

      <div className="border-t border-slate-200 p-3 space-y-2">
        <button
          type="button"
          disabled={loading}
          onClick={onEjecutar}
          className="w-full h-9 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
        >
          {loading ? "Ejecutando..." : "Ejecutar pivot"}
        </button>
        <button
          type="button"
          onClick={onGuardar}
          className="w-full h-9 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-sm font-medium rounded transition-colors"
        >
          Guardar como workspace
        </button>
      </div>
    </aside>
  );
}

function Section({
  title,
  count,
  total,
  isOpen,
  toggle,
  children,
}: {
  title: string;
  count: number;
  total: number | null;
  isOpen: boolean;
  toggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-slate-100">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
      >
        <span className="flex items-center gap-1.5">
          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {title}
        </span>
        <span className="text-[10px] text-slate-500 font-mono">
          {count}
          {total !== null ? `/${total}` : ""}
        </span>
      </button>
      {isOpen && <div>{children}</div>}
    </div>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-slate-50",
        checked && "bg-brand-50 hover:bg-brand-100 text-brand-900",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
      />
      <span className="truncate">{label}</span>
    </label>
  );
}
