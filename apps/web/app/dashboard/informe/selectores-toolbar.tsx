"use client";

// Toolbar con todos los controles del informe:
//   - Periodo (dropdown)
//   - Entidad propia (la que se resalta en azul oscuro en las tablas)
//   - Peer group (modal con multi-select buscable)
//   - Tema (paleta de colores: arequipa/huancayo/cusco/piura/etc)
//
// Al cambiar cualquiera, se navega a /dashboard/informe?periodo=X&...
// y Next re-renderea el server component con los nuevos params.

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { useMemo, useState, useTransition } from "react";
import { Calendar, Users, X, Search, Check, Crown, Palette, ArrowUp, ArrowDown, GripVertical } from "lucide-react";

import type { EntidadDisponible } from "@/lib/domains/informe";
import { TEMAS_PRESET } from "@/lib/domains/informe";
import { TIPO_ENTIDAD_ORDER, tipoEntidadLabel } from "@/app/dashboard/_lib/format";

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
  temaActual,
  periodosDisponibles,
  entidadesDisponibles,
}: {
  periodoActual: number;
  peerGroupActual: string[];
  entidadPropia: string;
  temaActual: string | null;
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
    tema?: string | null;
  }) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (changes.periodo !== undefined) sp.set("periodo", String(changes.periodo));
    if (changes.entidadPropia !== undefined) {
      if (changes.entidadPropia) sp.set("entidadPropia", changes.entidadPropia);
      else sp.delete("entidadPropia");
    }
    if (changes.tema !== undefined) {
      if (changes.tema) sp.set("tema", changes.tema);
      else sp.delete("tema");
    }
    if (changes.peerGroup !== undefined) {
      const propio = changes.entidadPropia ?? entidadPropia;
      const filtered = changes.peerGroup.filter((p) => p !== propio);
      if (filtered.length > 0) sp.set("peerGroup", filtered.join(","));
      else sp.delete("peerGroup");
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

          <SelectorTema
            valor={temaActual}
            disabled={isPending}
            onChange={(v) => navegar({ tema: v })}
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
          onClose={() => setEditorAbierto(false)}
          onAplicar={(nuevo) => {
            setEditorAbierto(false);
            navegar({ peerGroup: nuevo });
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

function SelectorTema({
  valor,
  disabled,
  onChange,
}: {
  valor: string | null;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const temaActual = TEMAS_PRESET.find((t) => t.id === valor) ?? TEMAS_PRESET[0];

  return (
    <div className="relative flex items-center gap-2">
      <Palette className="w-4 h-4 text-slate-500" />
      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Tema:</label>
      <button
        type="button"
        onClick={() => setAbierto(!abierto)}
        disabled={disabled}
        className="h-8 px-3 text-sm border border-slate-300 rounded bg-white inline-flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50"
      >
        <span className="inline-flex gap-0.5">
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: temaActual.primary }} />
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: temaActual.secondary }} />
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: temaActual.acento }} />
        </span>
        <span className="text-xs">{temaActual.nombre.split("(")[0].trim()}</span>
      </button>
      {abierto && (
        <div
          className="absolute top-10 left-0 z-30 bg-white border border-slate-200 rounded-lg shadow-xl p-2 min-w-[260px]"
          onMouseLeave={() => setAbierto(false)}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2 pb-1">Paleta de colores</p>
          {TEMAS_PRESET.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onChange(t.id);
                setAbierto(false);
              }}
              className={`w-full text-left px-2 py-2 rounded hover:bg-slate-50 inline-flex items-center gap-3 ${
                t.id === valor ? "bg-brand-50" : ""
              }`}
            >
              <span className="inline-flex gap-0.5 flex-shrink-0">
                <span className="w-4 h-4 rounded-sm" style={{ backgroundColor: t.primary }} />
                <span className="w-4 h-4 rounded-sm" style={{ backgroundColor: t.secondary }} />
                <span className="w-4 h-4 rounded-sm" style={{ backgroundColor: t.acento }} />
              </span>
              <span className="text-xs text-slate-700 flex-1">{t.nombre}</span>
              {t.id === valor && <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Modal Peer Group Editor
// ============================================================================

function PeerGroupEditor({
  peerGroupActual,
  entidadPropia,
  entidadesDisponibles,
  onClose,
  onAplicar,
}: {
  peerGroupActual: string[];
  entidadPropia: string;
  entidadesDisponibles: EntidadDisponible[];
  onClose: () => void;
  onAplicar: (nuevo: string[]) => void;
}) {
  // Usamos array en lugar de Set para preservar el orden que el usuario
  // elige. El primero del array se renderea como primera columna en las
  // tablas del informe.
  const [orden, setOrden] = useState<string[]>([...peerGroupActual]);
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

  const moverArriba = (idx: number) => {
    if (idx <= 0) return;
    setOrden((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moverAbajo = (idx: number) => {
    setOrden((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
      return next;
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
              Selecciona las entidades que aparecen en el informe y reordénalas con las flechas. La entidad propia ({entidadPropia}) siempre se incluye.
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
                          <p className="text-sm text-slate-900 truncate">
                            {e.nombCorreg}
                            {esPropio && (
                              <span className="ml-2 text-[10px] uppercase font-bold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">
                                propia
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {tipoEntidadLabel(e.tipoEntidad)} {e.microfinanciera ? "· microfinanciera" : ""}
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
                  return (
                    <li
                      key={nomb}
                      draggable
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, idx)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-2 px-2 py-1.5 bg-white border rounded text-sm transition-all ${
                        isDragging
                          ? "opacity-40 border-brand-400"
                          : isDropTarget
                            ? "border-brand-500 border-2 shadow-md -translate-y-0.5"
                            : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <span
                        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 select-none"
                        title="Arrastrar para reordenar"
                      >
                        <GripVertical className="w-4 h-4" />
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 w-4 text-right">{idx + 1}</span>
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
                        onClick={() => moverArriba(idx)}
                        disabled={idx === 0}
                        className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Subir"
                      >
                        <ArrowUp className="w-3.5 h-3.5 text-slate-600" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moverAbajo(idx)}
                        disabled={idx === orden.length - 1}
                        className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Bajar"
                      >
                        <ArrowDown className="w-3.5 h-3.5 text-slate-600" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(nomb)}
                        disabled={esPropio}
                        className="p-1 rounded hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={esPropio ? "La entidad propia no se puede quitar (sí mover)" : "Quitar"}
                      >
                        <X className="w-3.5 h-3.5 text-rose-600" />
                      </button>
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
              onClick={() => onAplicar(orden)}
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
