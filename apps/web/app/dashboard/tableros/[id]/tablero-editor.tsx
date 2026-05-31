"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  ArrowLeft,
  BarChart3,
  Hash,
  LayoutGrid,
  LineChart as LineIcon,
  PieChart as PieIcon,
  Plus,
  Settings2,
  Table as TableIcon,
  Trash2,
  Type,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { useConfirm } from "@/components/ui";

import type { Tablero, TableroWidget, WidgetTipo } from "@/lib/domains/tableros";
import { WidgetRenderer } from "./widget-renderer";
import { WidgetEditorModal } from "./widget-editor-modal";

// react-grid-layout no soporta SSR — siempre client side
const GridLayout = dynamic(
  async () => (await import("react-grid-layout")).Responsive,
  { ssr: false },
);
const WidthProvider = dynamic(
  async () => {
    const mod = await import("react-grid-layout");
    return { default: mod.WidthProvider(mod.Responsive) };
  },
  { ssr: false },
);
void GridLayout;

const TIPOS_DISPONIBLES: Array<{ tipo: WidgetTipo; label: string; icon: typeof Hash }> = [
  { tipo: "kpi", label: "KPI", icon: Hash },
  { tipo: "chart_line", label: "Linea", icon: LineIcon },
  { tipo: "chart_bar", label: "Barras", icon: BarChart3 },
  { tipo: "chart_area", label: "Area", icon: LineIcon },
  { tipo: "chart_pie", label: "Torta", icon: PieIcon },
  { tipo: "chart_combo", label: "Combo", icon: BarChart3 },
  { tipo: "table", label: "Tabla", icon: TableIcon },
  { tipo: "markdown", label: "Texto", icon: Type },
];

export function TableroEditor({ tablero: initial }: { tablero: Tablero }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [tablero, setTablero] = useState<Tablero>(initial);
  const [editandoWidget, setEditandoWidget] = useState<TableroWidget | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Layout para react-grid-layout
  const layout: Layout[] = useMemo(
    () =>
      tablero.widgets.map((w) => ({
        i: w.id,
        x: w.posX,
        y: w.posY,
        w: w.posW,
        h: w.posH,
        minW: 2,
        minH: 2,
      })),
    [tablero.widgets],
  );

  const onLayoutChange = useCallback(
    async (newLayout: Layout[]) => {
      // Aplicar localmente
      setTablero((prev) => ({
        ...prev,
        widgets: prev.widgets.map((w) => {
          const l = newLayout.find((x) => x.i === w.id);
          if (!l) return w;
          return { ...w, posX: l.x, posY: l.y, posW: l.w, posH: l.h };
        }),
      }));
      // Persistir
      try {
        await fetch(`/api/v1/tableros/${tablero.id}/widgets`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            layout: newLayout.map((l) => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h })),
          }),
        });
      } catch (e) {
        console.error("Layout save failed", e);
      }
    },
    [tablero.id],
  );

  const agregarWidget = async (tipo: WidgetTipo) => {
    setAgregando(false);
    setError(null);
    // Calcular nextY: el siguiente Y libre tras todos los widgets existentes.
    // (Infinity no es JSON valido — se serializa como null y rompia el endpoint.)
    const nextY = tablero.widgets.length === 0
      ? 0
      : Math.max(...tablero.widgets.map((w) => w.posY + w.posH));
    try {
      const r = await fetch(`/api/v1/tableros/${tablero.id}/widgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          titulo: TIPOS_DISPONIBLES.find((t) => t.tipo === tipo)?.label,
          config: tipo === "markdown" ? { content: "## Titulo\n\nEscribe tu contenido aqui." } : {},
          posX: 0,
          posY: nextY,
          posW: tipo === "kpi" ? 3 : tipo === "markdown" ? 6 : 6,
          posH: tipo === "kpi" ? 2 : 4,
        }),
      });
      const json = await r.json();
      if (json.error) {
        setError(`No se pudo crear el widget: ${json.error.message ?? "error desconocido"}`);
        console.error("Add widget failed", json.error);
        return;
      }
      if (json.data) {
        const widget = json.data as TableroWidget;
        setTablero((prev) => ({ ...prev, widgets: [...prev.widgets, widget] }));
        setEditandoWidget(widget);
      } else {
        setError("Respuesta inesperada del servidor al crear el widget.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Error de red al crear widget: ${msg}`);
      console.error("Add widget failed", e);
    }
  };

  const guardarWidget = async (widget: TableroWidget) => {
    setError(null);
    try {
      const r = await fetch(`/api/v1/tableros/${tablero.id}/widgets/${widget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: widget.titulo,
          config: widget.config,
        }),
      });
      const json = await r.json();
      if (json.error) {
        setError(`No se pudo guardar el widget: ${json.error.message ?? "error"}`);
        return;
      }
      if (json.data) {
        setTablero((prev) => ({
          ...prev,
          widgets: prev.widgets.map((w) => (w.id === widget.id ? (json.data as TableroWidget) : w)),
        }));
      }
    } catch (e) {
      setError(`Error de red al guardar: ${e instanceof Error ? e.message : String(e)}`);
    }
    setEditandoWidget(null);
  };

  const eliminarWidget = async (widgetId: string) => {
    const ok = await confirm({
      title: "Eliminar widget",
      message: "Esta accion no se puede deshacer.",
      confirmLabel: "Eliminar",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      const r = await fetch(`/api/v1/tableros/${tablero.id}/widgets/${widgetId}`, {
        method: "DELETE",
      });
      const json = await r.json().catch(() => ({}));
      if (json.error) {
        setError(`No se pudo eliminar el widget: ${json.error.message ?? "error"}`);
        return;
      }
      setTablero((prev) => ({
        ...prev,
        widgets: prev.widgets.filter((w) => w.id !== widgetId),
      }));
    } catch (e) {
      setError(`Error de red al eliminar: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => router.push("/dashboard/tableros" as never)}
            className="text-slate-500 hover:text-slate-900"
            aria-label="Volver"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 truncate">
              {tablero.nombre}
            </h1>
            {tablero.descripcion && (
              <p className="text-xs text-slate-500 truncate">{tablero.descripcion}</p>
            )}
          </div>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setAgregando((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 h-9 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg"
          >
            <Plus className="w-4 h-4" />
            Agregar widget
          </button>
          {agregando && (
            <div
              className="absolute right-0 top-11 z-30 bg-white border border-slate-200 rounded-lg shadow-lg p-2 grid grid-cols-2 gap-1 w-72"
              onMouseLeave={() => setAgregando(false)}
            >
              {TIPOS_DISPONIBLES.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.tipo}
                    type="button"
                    onClick={() => agregarWidget(t.tipo)}
                    className="flex flex-col items-center gap-1 p-3 hover:bg-slate-50 rounded text-xs text-slate-700"
                  >
                    <Icon className="w-5 h-5 text-brand-600" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      {error && (
        <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700 flex items-start justify-between gap-2">
          <span className="break-words">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-500 hover:text-rose-700 flex-shrink-0"
          >
            ×
          </button>
        </div>
      )}

      {tablero.widgets.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-xl">
          <LayoutGrid className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-600 mb-2">Tablero vacio</p>
          <p className="text-xs text-slate-500">Hace click en "Agregar widget" para empezar.</p>
        </div>
      ) : (
        <ResponsiveGrid
          layout={layout}
          onLayoutChange={onLayoutChange}
          widgets={tablero.widgets}
          onEdit={setEditandoWidget}
          onDelete={eliminarWidget}
        />
      )}

      {editandoWidget && (
        <WidgetEditorModal
          widget={editandoWidget}
          onCancel={() => setEditandoWidget(null)}
          onSave={guardarWidget}
        />
      )}
    </div>
  );
}

function ResponsiveGrid({
  layout,
  onLayoutChange,
  widgets,
  onEdit,
  onDelete,
}: {
  layout: Layout[];
  onLayoutChange: (l: Layout[]) => void;
  widgets: TableroWidget[];
  onEdit: (w: TableroWidget) => void;
  onDelete: (id: string) => void;
}) {
  // WidthProvider HOC via dynamic — usamos un wrapper local
  return (
    <ClientGrid
      layout={layout}
      onLayoutChange={onLayoutChange}
      widgets={widgets}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );
}

// Wrapper que se carga solo en el browser
function ClientGrid(props: {
  layout: Layout[];
  onLayoutChange: (l: Layout[]) => void;
  widgets: TableroWidget[];
  onEdit: (w: TableroWidget) => void;
  onDelete: (id: string) => void;
}) {
  // react-grid-layout requires its own provider client-side
  // We use the standard Responsive layout with manual width based on container
  return <DragDropGrid {...props} />;
}

// El verdadero grid (importado dinamicamente abajo)
const DragDropGrid = dynamic(() => import("./drag-drop-grid").then((m) => m.DragDropGrid), {
  ssr: false,
  loading: () => (
    <div className="h-96 flex items-center justify-center text-sm text-slate-500">
      Cargando layout...
    </div>
  ),
});

export function WidgetCard({
  widget,
  onEdit,
  onDelete,
}: {
  widget: TableroWidget;
  onEdit: (w: TableroWidget) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col h-full overflow-hidden">
      <header className="h-9 flex items-center justify-between px-3 border-b border-slate-200 bg-slate-50/50 widget-drag-handle cursor-move">
        <h3 className="text-xs font-semibold text-slate-800 truncate">
          {widget.titulo ?? widget.tipo}
        </h3>
        <div className="flex items-center gap-1 widget-no-drag">
          {/* widget-no-drag: react-grid-layout draggableCancel selector — sin
              esto el handler de drag swallow los clicks y los botones no
              responden. */}
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(widget);
            }}
            className="text-slate-400 hover:text-slate-700 p-1 widget-no-drag"
            aria-label="Editar"
          >
            <Settings2 className="w-3.5 h-3.5 pointer-events-none" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(widget.id);
            }}
            className="text-slate-400 hover:text-rose-600 p-1 widget-no-drag"
            aria-label="Eliminar"
          >
            <Trash2 className="w-3.5 h-3.5 pointer-events-none" />
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0">
        <WidgetRenderer widget={widget} />
      </div>
    </div>
  );
}
