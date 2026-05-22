"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Database, Search, Table } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { formatNumberCompact } from "@/app/dashboard/_lib/format";

type TablaInfo = {
  schema: string;
  tabla: string;
  tipo: "table" | "view" | "materialized_view";
  comentario: string | null;
  filas: number | null;
};

type ColInfo = {
  nombre: string;
  tipo: string;
  nullable: boolean;
  comentario: string | null;
  posicion: number;
};

type TablaDetalle = TablaInfo & {
  columnas: ColInfo[];
  sampleRows: Array<Record<string, unknown>>;
};

export function CatalogClient() {
  const [tablas, setTablas] = useState<TablaInfo[]>([]);
  const [seleccionada, setSeleccionada] = useState<{ schema: string; tabla: string } | null>(
    null,
  );
  const [detalle, setDetalle] = useState<TablaDetalle | null>(null);
  const [cargando, setCargando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openSchemas, setOpenSchemas] = useState<Set<string>>(new Set(["marts", "dw"]));

  useEffect(() => {
    fetch("/api/v1/catalog")
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setTablas(json.data.rows as TablaInfo[]);
        else setError(json.error?.message ?? "Error");
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!seleccionada) {
      setDetalle(null);
      return;
    }
    setCargando(true);
    setError(null);
    fetch(`/api/v1/catalog/${seleccionada.schema}/${seleccionada.tabla}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setDetalle(json.data as TablaDetalle);
        else setError(json.error?.message ?? "Error");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setCargando(false));
  }, [seleccionada]);

  const agrupado = useMemo(() => {
    const q = busqueda.toLowerCase();
    const filt = busqueda
      ? tablas.filter(
          (t) =>
            t.tabla.toLowerCase().includes(q) ||
            (t.comentario ?? "").toLowerCase().includes(q),
        )
      : tablas;
    const map = new Map<string, TablaInfo[]>();
    for (const t of filt) {
      if (!map.has(t.schema)) map.set(t.schema, []);
      map.get(t.schema)!.push(t);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tablas, busqueda]);

  return (
    <div className="flex h-[calc(100vh-120px)] bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
      <aside className="w-72 flex-shrink-0 border-r border-slate-200 bg-slate-50/50 flex flex-col">
        <header className="h-12 border-b border-slate-200 px-3 flex items-center">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            <Database className="w-4 h-4" />
            Catalog
          </h3>
        </header>

        <div className="p-2 border-b border-slate-200">
          <div className="flex items-center gap-1 bg-white rounded px-2 h-8 border border-slate-200">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar tabla..."
              className="flex-1 bg-transparent text-xs outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {agrupado.map(([schema, tablasArr]) => {
            const isOpen = openSchemas.has(schema);
            return (
              <div key={schema} className="border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setOpenSchemas((prev) => {
                      const next = new Set(prev);
                      if (next.has(schema)) next.delete(schema);
                      else next.add(schema);
                      return next;
                    });
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
                >
                  <span className="flex items-center gap-1.5">
                    {isOpen ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    {schema}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {tablasArr.length}
                  </span>
                </button>
                {isOpen && (
                  <ul>
                    {tablasArr.map((t) => {
                      const active =
                        seleccionada?.schema === t.schema && seleccionada?.tabla === t.tabla;
                      return (
                        <li key={`${t.schema}.${t.tabla}`}>
                          <button
                            type="button"
                            onClick={() =>
                              setSeleccionada({ schema: t.schema, tabla: t.tabla })
                            }
                            className={cn(
                              "w-full text-left px-6 py-1.5 text-xs hover:bg-white flex items-center gap-1.5",
                              active && "bg-brand-50 hover:bg-brand-100 text-brand-900",
                            )}
                          >
                            <Table className="w-3 h-3 text-slate-400 flex-shrink-0" />
                            <span className="truncate">{t.tabla}</span>
                            {t.tipo === "materialized_view" && (
                              <span className="text-[9px] px-1 bg-violet-100 text-violet-700 rounded">
                                MV
                              </span>
                            )}
                            {t.tipo === "view" && (
                              <span className="text-[9px] px-1 bg-sky-100 text-sky-700 rounded">
                                V
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!seleccionada ? (
          <div className="flex items-center justify-center h-full text-sm text-slate-500">
            Selecciona una tabla a la izquierda.
          </div>
        ) : cargando ? (
          <div className="flex items-center justify-center h-full text-sm text-slate-500">
            Cargando...
          </div>
        ) : error ? (
          <div className="px-4 py-2 m-4 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
            {error}
          </div>
        ) : detalle ? (
          <div className="flex-1 overflow-y-auto">
            <header className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h1 className="text-lg font-bold text-slate-900 font-mono">
                {detalle.schema}.{detalle.tabla}
              </h1>
              {detalle.comentario && (
                <p className="text-sm text-slate-600 mt-1">{detalle.comentario}</p>
              )}
              <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                <span>
                  Tipo: <span className="font-semibold">{detalle.tipo}</span>
                </span>
                {detalle.filas !== null && (
                  <span>
                    Filas aprox:{" "}
                    <span className="font-semibold tabular-nums">
                      {formatNumberCompact(detalle.filas)}
                    </span>
                  </span>
                )}
                <span>
                  Columnas: <span className="font-semibold">{detalle.columnas.length}</span>
                </span>
              </div>
            </header>

            <section className="px-6 py-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Columnas
              </h2>
              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600 w-8">#</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600">Nombre</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600">Tipo</th>
                      <th className="text-center px-3 py-2 font-semibold text-slate-600 w-16">
                        Null
                      </th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-600">
                        Comentario
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detalle.columnas.map((c) => (
                      <tr key={c.nombre} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5 text-slate-400 tabular-nums">{c.posicion}</td>
                        <td className="px-3 py-1.5 font-mono font-medium text-slate-900">
                          {c.nombre}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-slate-600">{c.tipo}</td>
                        <td className="px-3 py-1.5 text-center">
                          {c.nullable ? (
                            <span className="text-[10px] text-amber-700">YES</span>
                          ) : (
                            <span className="text-[10px] text-slate-400">NO</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">{c.comentario ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="px-6 py-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Sample (primeras 10 filas)
              </h2>
              {detalle.sampleRows.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Sin datos para mostrar.</p>
              ) : (
                <div className="border border-slate-200 rounded overflow-auto max-h-96">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        {detalle.columnas.map((c) => (
                          <th
                            key={c.nombre}
                            className="text-left px-3 py-2 font-semibold text-slate-600 font-mono whitespace-nowrap"
                          >
                            {c.nombre}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detalle.sampleRows.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          {detalle.columnas.map((c) => {
                            const v = row[c.nombre];
                            return (
                              <td
                                key={c.nombre}
                                className="px-3 py-1.5 text-slate-700 whitespace-nowrap"
                              >
                                {v === null || v === undefined
                                  ? "—"
                                  : typeof v === "object"
                                    ? JSON.stringify(v)
                                    : String(v)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
