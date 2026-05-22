"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  BarChart3,
  Building2,
  Code,
  Database,
  FileText,
  History,
  LayoutDashboard,
  MailPlus,
  NotebookText,
  Search,
  Settings,
  Sparkles,
  TableProperties,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

type NavItem = {
  label: string;
  description?: string;
  group: "Navegacion" | "Tableros" | "Notebooks" | "Workspaces" | "Queries" | "Entidades" | "Acciones rapidas";
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  action?: () => void;
  keywords?: string[];
};

type Tablero = { id: string; nombre: string };
type Notebook = { id: string; titulo: string };
type Workspace = { id: string; nombre: string };
type SavedQuery = { id: string; nombre: string };
type Entidad = { nombCorreg: string };

const NAV_BASE: NavItem[] = [
  { label: "Resumen", group: "Navegacion", icon: BarChart3, href: "/dashboard", keywords: ["home", "kpis"] },
  { label: "Estados Financieros", group: "Navegacion", icon: FileText, href: "/dashboard/eeff", keywords: ["eeff", "estados"] },
  { label: "Tableros", group: "Navegacion", icon: LayoutDashboard, href: "/dashboard/tableros", keywords: ["dashboards"] },
  { label: "Analisis Dinamico", group: "Navegacion", icon: TableProperties, href: "/dashboard/analisis", keywords: ["pivot", "excel"] },
  { label: "Notebooks", group: "Navegacion", icon: NotebookText, href: "/dashboard/notebooks" },
  { label: "Genie", group: "Navegacion", icon: Sparkles, href: "/dashboard/genie", keywords: ["ai", "nl2sql"] },
  { label: "SQL Workbench", group: "Navegacion", icon: Code, href: "/dashboard/sql", keywords: ["sql", "query"] },
  { label: "Catalog", group: "Navegacion", icon: Database, href: "/dashboard/catalog", keywords: ["schema", "tablas"] },
  { label: "Configuracion", group: "Navegacion", icon: Settings, href: "/dashboard/settings" },
];

const ACTIONS_BASE: NavItem[] = [
  { label: "Nuevo tablero", description: "Crear dashboard multi-widget", group: "Acciones rapidas", icon: LayoutDashboard, href: "/dashboard/tableros" },
  { label: "Nuevo notebook", description: "Reporte con SQL + markdown + charts", group: "Acciones rapidas", icon: NotebookText, href: "/dashboard/notebooks" },
  { label: "Preguntar a Genie", description: "NL2SQL via Claude/Ollama", group: "Acciones rapidas", icon: Sparkles, href: "/dashboard/genie" },
  { label: "Ejecutar SQL ad-hoc", description: "Workbench con Monaco", group: "Acciones rapidas", icon: Code, href: "/dashboard/sql" },
  { label: "Invitar usuario", description: "Generar token de invitacion", group: "Acciones rapidas", icon: MailPlus, href: "/dashboard/settings?tab=invitaciones" },
  { label: "Ver auditoria", description: "Historial de cambios sensibles", group: "Acciones rapidas", icon: History, href: "/dashboard/settings?tab=auditoria" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tableros, setTableros] = useState<Tablero[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [entidades, setEntidades] = useState<Entidad[]>([]);

  // Atajo global: Cmd+K (Mac) / Ctrl+K (Win/Linux)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Lazy-load datos solo cuando se abre (no inflar cada navegacion)
  useEffect(() => {
    if (!open) return;
    Promise.all([
      fetch("/api/v1/tableros").then((r) => r.json()).catch(() => null),
      fetch("/api/v1/notebooks").then((r) => r.json()).catch(() => null),
      fetch("/api/v1/workspaces").then((r) => r.json()).catch(() => null),
      fetch("/api/v1/sql/queries").then((r) => r.json()).catch(() => null),
      fetch("/api/v1/entidades").then((r) => r.json()).catch(() => null),
    ]).then(([t, n, w, q, e]) => {
      if (t?.data?.rows) setTableros(t.data.rows as Tablero[]);
      if (n?.data?.rows) setNotebooks(n.data.rows as Notebook[]);
      if (w?.data?.rows) setWorkspaces(w.data.rows as Workspace[]);
      if (q?.data?.rows) setSavedQueries(q.data.rows as SavedQuery[]);
      if (e?.data?.rows) setEntidades(e.data.rows as Entidad[]);
    });
  }, [open]);

  const items = useMemo<NavItem[]>(() => {
    const dynamic: NavItem[] = [
      ...tableros.map<NavItem>((t) => ({
        label: t.nombre,
        group: "Tableros",
        icon: LayoutDashboard,
        href: `/dashboard/tableros/${t.id}`,
        keywords: ["tablero", "dashboard"],
      })),
      ...notebooks.map<NavItem>((n) => ({
        label: n.titulo,
        group: "Notebooks",
        icon: NotebookText,
        href: `/dashboard/notebooks/${n.id}`,
        keywords: ["notebook"],
      })),
      ...workspaces.map<NavItem>((w) => ({
        label: w.nombre,
        description: "Workspace de Analisis Dinamico",
        group: "Workspaces",
        icon: TableProperties,
        href: `/dashboard/analisis`,
        keywords: ["analisis", "pivot"],
      })),
      ...savedQueries.map<NavItem>((q) => ({
        label: q.nombre,
        description: "Query guardada",
        group: "Queries",
        icon: Code,
        href: `/dashboard/sql`,
        keywords: ["sql", "query"],
      })),
      ...entidades.slice(0, 50).map<NavItem>((e) => ({
        label: e.nombCorreg,
        description: "Ver EE.FF.",
        group: "Entidades",
        icon: Building2,
        href: `/dashboard/eeff?entidad=${encodeURIComponent(e.nombCorreg)}`,
        keywords: ["entidad", "banco", "caja"],
      })),
    ];
    return [...NAV_BASE, ...ACTIONS_BASE, ...dynamic];
  }, [tableros, notebooks, workspaces, savedQueries, entidades]);

  const groupedItems = useMemo(() => {
    const map = new Map<string, NavItem[]>();
    for (const item of items) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item);
    }
    // Orden de grupos: Acciones rapidas primero (mas frecuente),
    // luego Navegacion, despues contenido por tipo
    const orden = [
      "Acciones rapidas",
      "Navegacion",
      "Tableros",
      "Notebooks",
      "Workspaces",
      "Queries",
      "Entidades",
    ];
    return orden
      .map((g) => [g, map.get(g) ?? []] as const)
      .filter(([, items]) => items.length > 0);
  }, [items]);

  const onSelect = useCallback(
    (item: NavItem) => {
      if (item.action) item.action();
      if (item.href) router.push(item.href as never);
      setOpen(false);
      setQuery("");
    },
    [router],
  );

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-start justify-center pt-[15vh] px-4"
          onClick={() => setOpen(false)}
        >
          <Command
            shouldFilter
            className="w-full max-w-xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            label="Command Palette"
          >
            <div className="flex items-center gap-2 px-3 border-b border-slate-200">
              <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Buscar acciones, tableros, notebooks, entidades..."
                className="flex-1 h-11 bg-transparent text-sm outline-none placeholder:text-slate-400"
                autoFocus
              />
              <kbd className="text-[10px] text-slate-400 font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                ESC
              </kbd>
            </div>

            <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-sm text-slate-500">
                Sin resultados para &quot;{query}&quot;
              </Command.Empty>

              {groupedItems.map(([groupName, groupItems]) => (
                <Command.Group
                  key={groupName}
                  heading={
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2 py-1.5 block">
                      {groupName}
                    </span>
                  }
                >
                  {groupItems.map((item, idx) => {
                    const Icon = item.icon;
                    return (
                      <Command.Item
                        key={`${groupName}-${idx}-${item.label}`}
                        value={`${item.label} ${item.description ?? ""} ${item.keywords?.join(" ") ?? ""}`}
                        onSelect={() => onSelect(item)}
                        className={cn(
                          "flex items-center gap-2.5 px-2 py-2 rounded-md cursor-pointer text-sm",
                          "data-[selected=true]:bg-slate-100 data-[selected=true]:text-slate-900",
                          "text-slate-700",
                        )}
                      >
                        <div className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-3.5 h-3.5 text-slate-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{item.label}</div>
                          {item.description && (
                            <div className="text-[11px] text-slate-500 truncate">
                              {item.description}
                            </div>
                          )}
                        </div>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>

            <footer className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-[10px] text-slate-500">
              <div className="flex items-center gap-3">
                <span>
                  <kbd className="font-mono bg-white border border-slate-200 px-1 py-0.5 rounded">↑↓</kbd> navegar
                </span>
                <span>
                  <kbd className="font-mono bg-white border border-slate-200 px-1 py-0.5 rounded">↵</kbd> abrir
                </span>
                <span>
                  <kbd className="font-mono bg-white border border-slate-200 px-1 py-0.5 rounded">ESC</kbd> cerrar
                </span>
              </div>
              <span className="text-slate-400">Aibenchef Command Palette</span>
            </footer>
          </Command>
        </div>
      )}
    </>
  );
}

// Boton trigger en el header (con hint visual del shortcut)
export function CommandPaletteTrigger() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // El palette se abre solo via el event listener global de CommandPalette.
        // Aqui solo actualizamos UI del boton si quisieramos. No hacemos nada.
        setOpen(true);
        setTimeout(() => setOpen(false), 200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        // Disparar Cmd+K sinteticamente
        const event = new KeyboardEvent("keydown", { key: "k", metaKey: true });
        window.dispatchEvent(event);
      }}
      className={cn(
        "hidden sm:inline-flex items-center gap-2 px-2.5 h-8 bg-slate-100 hover:bg-slate-200 rounded-md text-xs text-slate-600 border border-slate-200 transition",
        open && "bg-slate-200",
      )}
      aria-label="Abrir buscador"
    >
      <Search className="w-3.5 h-3.5" />
      <span>Buscar</span>
      <kbd className="font-mono text-[10px] bg-white border border-slate-200 px-1 py-0.5 rounded">
        Ctrl K
      </kbd>
    </button>
  );
}
