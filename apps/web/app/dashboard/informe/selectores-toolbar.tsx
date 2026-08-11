"use client";

// Toolbar con todos los controles del informe:
//   - Periodo (dropdown)
//   - Entidad propia (la que se resalta en azul oscuro en las tablas)
//   - Peer group (modal con multi-select buscable)
//
// Color picker per entidad: en cada chip de COMPARATIVA del header.
// El tema preset global (arequipa/huancayo/...) fue eliminado porque
// confundia con el picker per-entidad. La marca default cubre los casos.
//
// Al cambiar cualquiera, se navega a /dashboard/informe?periodo=X&...
// y Next re-renderea el server component con los nuevos params.

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { useMemo, useState, useTransition } from "react";
import { Calendar, Users, X, Search, Check, Crown, GripVertical } from "lucide-react";

import type { EntidadDisponible } from "@/lib/domains/informe";
import { TIPO_ENTIDAD_ORDER, tipoEntidadLabel } from "@/app/dashboard/_lib/format";
import { EntidadFreshnessBadge, RenombresToggle } from "@/components/ui";
import {
  computeMaxUltimoPeriodo,
  fmtPeriodoLabel,
} from "@/lib/utils/periodo-freshness";

function periodoLabel(periodo: number): string {
  const anio = Math.floor(periodo / 100);
  const mes = periodo % 100;
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${meses[mes - 1] ?? "?"} ${anio}`;
}

export function SelectoresToolbar({
  periodoActual,
  peerGroupActual,
  entidadPropia,
  consolidarActual,
  coloresActuales,
  periodosDisponibles,
  entidadesDisponibles,
}: {
  periodoActual: number;
  peerGroupActual: string[];
  entidadPropia: string;
  consolidarActual: boolean;
  /** Map nombCorreg -> hex. Refleja lo que ven los graficos hoy (incluye URL override + DB + fallback). */
  coloresActuales: Map<string, string>;
  periodosDisponibles: number[];
  entidadesDisponibles: EntidadDisponible[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [editorAbierto, setEditorAbierto] = useState(false);

  const navegar = (changes: {
    periodo?: number;
    peerGroup?: string[];
    entidadPropia?: string;
    consolidar?: boolean;
    colors?: Map<string, string> | null;
  }) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (changes.periodo !== undefined) sp.set("periodo", String(changes.periodo));
    if (changes.entidadPropia !== undefined) {
      if (changes.entidadPropia) sp.set("entidadPropia", changes.entidadPropia);
      else sp.delete("entidadPropia");
    }
    if (changes.consolidar !== undefined) {
      // Default es true; solo persistimos "false" en URL para mantenerla limpia.
      if (changes.consolidar) sp.delete("consolidar");
      else sp.set("consolidar", "false");
    }
    if (changes.peerGroup !== undefined) {
      // IMPORTANTE: NO filtrar la entidad propia. Su posicion en el array
      // ES el orden de la columna. Si la quitamos aca, el backend la
      // re-agrega al final y se pierde el orden del usuario.
      if (changes.peerGroup.length > 0) sp.set("peerGroup", changes.peerGroup.join(","));
      else sp.delete("peerGroup");
    }
    if (changes.colors !== undefined) {
      // Param canonico: colorOverrides (compartido con state local del informe
      // y endpoint API). Format: NOMB:#HEX,NOMB:#HEX (con # — parseFromUrl
      // en informe-client exige formato #RRGGBB).
      if (changes.colors && changes.colors.size > 0) {
        const serialized = [...changes.colors.entries()]
          .map(([nomb, hex]) => {
            const withHash = hex.startsWith("#") ? hex : `#${hex}`;
            return `${nomb}:${withHash.toUpperCase()}`;
          })
          .join(",");
        sp.set("colorOverrides", serialized);
        sp.delete("colors"); // limpia param viejo si quedo en URL
      } else {
        sp.delete("colorOverrides");
        sp.delete("colors");
      }
    }
    startTransition(() => {
      router.push(`${pathname}?${sp.toString()}` as Route);
    });
  };

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-4 py-3 flex flex-col gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <SelectorPeriodo
            valor={periodoActual}
            disponibles={periodosDisponibles}
            disabled={isPending}
            onChange={(v) => navegar({ periodo: v })}
          />

          <SelectorEntidadPropia
            valor={entidadPropia}
            disponibles={peerGroupActual}
            disabled={isPending}
            onChange={(v) => navegar({ entidadPropia: v })}
          />

          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-500" />
            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              Comparar con ({peerGroupActual.length}):
            </label>
            <button
              type="button"
              onClick={() => setEditorAbierto(true)}
              disabled={isPending}
              className="h-8 px-3 text-sm bg-brand-600 hover:bg-brand-700 text-white rounded transition-colors disabled:opacity-50"
            >
              Editar
            </button>
          </div>

          <RenombresToggle
            value={consolidarActual}
            onChange={(next) => navegar({ consolidar: next })}
            disabled={isPending}
          />

          {isPending && (
            <span className="text-xs text-slate-500 inline-flex items-center gap-2 ml-auto">
              <span className="w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              Actualizando...
            </span>
          )}
        </div>
      </div>

      {editorAbierto && (
        <PeerGroupEditor
          peerGroupActual={peerGroupActual}
          entidadPropia={entidadPropia}
          entidadesDisponibles={entidadesDisponibles}
          coloresActuales={coloresActuales}
          onClose={() => setEditorAbierto(false)}
          onAplicar={(nuevo, colores) => {
            setEditorAbierto(false);
            navegar({ peerGroup: nuevo, colors: colores });
          }}
        />
      )}
    </>
  );
}

// ============================================================================
// Selectores individuales
// ============================================================================

function SelectorPeriodo({
  valor,
  disponibles,
  disabled,
  onChange,
}: {
  valor: number;
  disponibles: number[];
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Calendar className="w-4 h-4 text-slate-500" />
      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Periodo:</label>
      <select
        value={valor}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
        disabled={disabled || disponibles.length === 0}
        className="h-8 px-2 text-sm border border-slate-300 rounded bg-white min-w-[140px] disabled:opacity-50"
      >
        {!disponibles.includes(valor) && (
          <option value={valor}>{periodoLabel(valor)} (no en MV)</option>
        )}
        {disponibles.map((p) => (
          <option key={p} value={p}>
            {periodoLabel(p)} ({p})
          </option>
        ))}
      </select>
    </div>
  );
}

function SelectorEntidadPropia({
  valor,
  disponibles,
  disabled,
  onChange,
}: {
  valor: string;
  disponibles: string[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Crown className="w-4 h-4 text-amber-500" />
      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Resaltar:</label>
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-8 px-2 text-sm border border-slate-300 rounded bg-white min-w-[160px] disabled:opacity-50"
        title="Esta es la entidad que se resalta en azul oscuro como 'la propia'"
      >
        {disponibles.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
    </div>
  );
}

// ============================================================================
// Modal Peer Group Editor
// ============================================================================

// Paleta sugerida de 20 colores con buen contraste — espejo de la del backend
// (lib/domains/informe/queries.ts PALETTE_ENTIDADES). Si la backend la cambia,
// actualizar aca tambien para que la UI no muestre opciones obsoletas.
const SUGGESTED_PALETTE = [
  "#0F2A5E", "#E91E63", "#4CAF50", "#C8102E", "#722F37",
  "#1E90FF", "#FF9800", "#9C27B0", "#8D6E63", "#00BCD4",
  "#FFEB3B", "#3F51B5", "#795548", "#009688", "#FFC107",
  "#673AB7", "#F44336", "#607D8B", "#7CB342", "#5D4037",
];

function PeerGroupEditor({
  peerGroupActual,
  entidadPropia,
  entidadesDisponibles,
  coloresActuales,
  onClose,
  onAplicar,
}: {
  peerGroupActual: string[];
  entidadPropia: string;
  entidadesDisponibles: EntidadDisponible[];
  coloresActuales: Map<string, string>;
  onClose: () => void;
  onAplicar: (nuevo: string[], colores: Map<string, string>) => void;
}) {
  // Usamos array en lugar de Set para preservar el orden que el usuario
  // elige. El primero del array se renderea como primera columna en las
  // tablas del informe.
  const [orden, setOrden] = useState<string[]>([...peerGroupActual]);
  // Map de colores en edicion. Inicializa con los colores actuales (URL +
  // DB + fallback) — asi el usuario VE lo que actualmente se renderiza.
  const [colores, setColores] = useState<Map<string, string>>(
    () => new Map(coloresActuales),
  );
  const [colorPickerAbierto, setColorPickerAbierto] = useState<string | null>(null);

  const setColor = (nomb: string, hex: string) => {
    setColores((prev) => {
      const next = new Map(prev);
      next.set(nomb, hex.toUpperCase());
      return next;
    });
  };
  const resetColor = (nomb: string) => {
    setColores((prev) => {
      const next = new Map(prev);
      next.delete(nomb);
      return next;
    });
  };
  const seleccionadas = useMemo(() => new Set(orden), [orden]);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string | null>(null);

  const tiposDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const e of entidadesDisponibles) set.add(e.tipoEntidad);
    return Array.from(set).sort((a, b) => {
      const oa = TIPO_ENTIDAD_ORDER[a] ?? 99;
      const ob = TIPO_ENTIDAD_ORDER[b] ?? 99;
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });
  }, [entidadesDisponibles]);

  // Max ultimoPeriodo del universo — referencia para calcular gap por-entidad
  // y mostrar el badge "sin data reciente". Consistente con DuPont y PE.
  const maxUltimoPeriodo = useMemo(
    () => computeMaxUltimoPeriodo(entidadesDisponibles),
    [entidadesDisponibles],
  );

  const filtradas = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    return entidadesDisponibles.filter((e) => {
      if (filtroTipo && e.tipoEntidad !== filtroTipo) return false;
      if (!q) return true;
      return e.nombCorreg.toLowerCase().includes(q) || e.tipoEntidad.toLowerCase().includes(q);
    });
  }, [entidadesDisponibles, busqueda, filtroTipo]);

  const toggle = (nomb: string) => {
    if (nomb === entidadPropia) return;
    setOrden((prev) => {
      if (prev.includes(nomb)) return prev.filter((x) => x !== nomb);
      return [...prev, nomb];
    });
  };

  // Drag and drop nativo HTML5 — sin libs externas.
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent<HTMLLIElement>, idx: number) => {
    setDraggingIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    // Firefox necesita setData para iniciar el drag.
    e.dataTransfer.setData("text/plain", String(idx));
  };

  const handleDragOver = (e: React.DragEvent<HTMLLIElement>, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTargetIdx !== idx) setDropTargetIdx(idx);
  };

  const handleDragLeave = () => {
    setDropTargetIdx(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLLIElement>, targetIdx: number) => {
    e.preventDefault();
    const sourceIdx = draggingIdx;
    setDraggingIdx(null);
    setDropTargetIdx(null);
    if (sourceIdx == null || sourceIdx === targetIdx) return;
    setOrden((prev) => {
      const next = [...prev];
      const [moved] = next.splice(sourceIdx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
  };

  const handleDragEnd = () => {
    setDraggingIdx(null);
    setDropTargetIdx(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Editar comparativa</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Selecciona entidades de la izquierda y arrástralas en la derecha para reordenar las columnas. La entidad propia ({entidadPropia}) siempre se incluye.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </header>

        <div className="px-6 py-3 border-b border-slate-200 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-slate-50 rounded px-3 h-9 border border-slate-300 flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar entidad..."
              className="flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => setFiltroTipo(null)}
              className={`px-2 py-1 text-xs rounded ${filtroTipo === null ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              Todos
            </button>
            {tiposDisponibles.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFiltroTipo(t)}
                className={`px-2 py-1 text-xs rounded ${filtroTipo === t ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                title={t}
              >
                {tipoEntidadLabel(t)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
          {/* Columna izquierda: lista de entidades disponibles */}
          <div className="overflow-y-auto px-6 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2 py-2 sticky top-0 bg-white">
              Disponibles ({filtradas.length})
            </p>
            {filtradas.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">No hay entidades. ¿Está poblada raw.eeff_observacion?</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filtradas.map((e) => {
                  const checked = seleccionadas.has(e.nombCorreg);
                  const esPropio = e.nombCorreg === entidadPropia;
                  return (
                    <li key={e.nombCorreg}>
                      <label className={`flex items-center gap-3 py-2 cursor-pointer hover:bg-slate-50 px-2 rounded ${esPropio ? "opacity-90" : ""}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={esPropio}
                          onChange={() => toggle(e.nombCorreg)}
                          className="w-4 h-4 rounded border-slate-300 text-brand-600"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-900 truncate flex items-center gap-2">
                            <span className="truncate">{e.nombCorreg}</span>
                            {esPropio && (
                              <span className="text-[10px] uppercase font-bold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded flex-shrink-0">
                                propia
                              </span>
                            )}
                            <EntidadFreshnessBadge
                              ultimoPeriodo={e.ultimoPeriodo}
                              maxDisponible={maxUltimoPeriodo}
                            />
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {tipoEntidadLabel(e.tipoEntidad)}
                            {e.microfinanciera ? " · microfinanciera" : ""}
                            {e.ultimoPeriodo ? ` · última data ${fmtPeriodoLabel(e.ultimoPeriodo)}` : ""}
                          </p>
                        </div>
                        {checked && <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Columna derecha: orden actual de las seleccionadas */}
          <div className="overflow-y-auto px-6 py-2 bg-slate-50/30">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2 py-2 sticky top-0 bg-slate-50">
              Orden de columnas ({orden.length})
            </p>
            {orden.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">Sin entidades seleccionadas.</p>
            ) : (
              <ol className="space-y-1">
                {orden.map((nomb, idx) => {
                  const esPropio = nomb === entidadPropia;
                  const isDragging = draggingIdx === idx;
                  const isDropTarget = dropTargetIdx === idx && draggingIdx !== null && draggingIdx !== idx;
                  const colorActual = colores.get(nomb) ?? coloresActuales.get(nomb) ?? "#888888";
                  const colorPickerOpen = colorPickerAbierto === nomb;
                  return (
                    <li
                      key={nomb}
                      draggable
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, idx)}
                      onDragEnd={handleDragEnd}
                      className={`relative flex items-center gap-2 px-2 py-1.5 bg-white border rounded text-sm transition-all ${
                        isDragging
                          ? "opacity-40 border-brand-400"
                          : isDropTarget
                            ? "border-brand-500 border-2 shadow-md -translate-y-0.5"
                            : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <span
                        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-700 select-none p-1"
                        title="Arrastrar para reordenar"
                      >
                        <GripVertical className="w-4 h-4" />
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 w-4 text-right">{idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => setColorPickerAbierto(colorPickerOpen ? null : nomb)}
                        className="w-6 h-6 rounded border-2 border-white shadow ring-1 ring-slate-300 hover:ring-slate-500 hover:scale-110 transition-all flex-shrink-0"
                        style={{ backgroundColor: colorActual }}
                        title={`Cambiar color (actual: ${colorActual.toUpperCase()})`}
                        aria-label={`Cambiar color de ${nomb}`}
                      />
                      <span className="flex-1 truncate text-slate-900">
                        {nomb}
                        {esPropio && (
                          <span className="ml-2 text-[10px] uppercase font-bold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">
                            propia
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggle(nomb)}
                        disabled={esPropio}
                        className="p-1 rounded hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={esPropio ? "La entidad propia no se puede quitar (sí arrastrar)" : "Quitar"}
                      >
                        <X className="w-3.5 h-3.5 text-rose-600" />
                      </button>

                      {colorPickerOpen && (
                        <div
                          className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-2xl p-3 w-[260px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                              Color para {nomb}
                            </p>
                            <button
                              type="button"
                              onClick={() => setColorPickerAbierto(null)}
                              className="p-0.5 rounded hover:bg-slate-100"
                            >
                              <X className="w-3 h-3 text-slate-500" />
                            </button>
                          </div>
                          <div className="grid grid-cols-10 gap-1 mb-2">
                            {SUGGESTED_PALETTE.map((p) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => {
                                  setColor(nomb, p);
                                  setColorPickerAbierto(null);
                                }}
                                className="w-5 h-5 rounded border border-slate-200 hover:scale-125 hover:ring-2 hover:ring-slate-400 transition-transform"
                                style={{ backgroundColor: p }}
                                title={p}
                                aria-label={`Color ${p}`}
                              />
                            ))}
                          </div>
                          <div className="flex items-center gap-2 mb-2">
                            <label className="text-[10px] text-slate-600">Hex:</label>
                            <input
                              type="color"
                              value={colorActual}
                              onChange={(e) => setColor(nomb, e.target.value)}
                              className="w-7 h-7 cursor-pointer rounded border border-slate-300"
                              aria-label="Selector de color personalizado"
                            />
                            <input
                              type="text"
                              value={colorActual.toUpperCase()}
                              onChange={(e) => {
                                const v = e.target.value.trim();
                                if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
                                  setColor(nomb, v.startsWith("#") ? v : `#${v}`);
                                }
                              }}
                              placeholder="#0F2A5E"
                              maxLength={7}
                              className="flex-1 h-7 px-2 text-xs font-mono border border-slate-300 rounded"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              resetColor(nomb);
                              setColorPickerAbierto(null);
                            }}
                            className="w-full text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
                            title="Vuelve al color asignado por defecto (config / paleta estable)"
                          >
                            Restablecer color por defecto
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>

        <footer className="px-6 py-3 border-t border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
          <p className="text-xs text-slate-600">
            <strong>{orden.length}</strong> entidades · primera columna: <strong>{orden[0] ?? "—"}</strong>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-sm rounded transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onAplicar(orden, colores)}
              disabled={orden.length === 0}
              className="h-9 px-4 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
            >
              Aplicar ({orden.length})
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
