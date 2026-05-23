"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  Play,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { SqlEditor } from "@/components/sql-editor";
import { formatNumber } from "@/app/dashboard/_lib/format";

const EJEMPLOS = [
  "Muestrame la mora promedio de las Cajas Municipales en los ultimos 12 meses",
  "Compara la utilidad neta de los bancos en marzo 2026",
  "ROA y ROE por entidad para CMACs en el ultimo periodo, ordenado por ROE descendente",
  "Cuanto crecio la cartera bruta de Mibanco anio a anio",
  "Top 10 entidades con mayor depositos del publico en TOTAL",
];

type Mensaje =
  | { rol: "user"; texto: string }
  | {
      rol: "genie";
      id: number;
      sql: string;
      explicacion: string;
      tokensInput: number;
      tokensOutput: number;
      duracionMs: number;
      feedback: 1 | -1 | null;
    };

type QueryResult = {
  columnas: Array<{ key: string; tipo: string }>;
  filas: Array<Record<string, unknown>>;
  totalFilas: number;
  duracionMs: number;
};

export function AibenClient() {
  const router = useRouter();
  const [conversacion, setConversacion] = useState<Mensaje[]>([]);
  const [prompt, setPrompt] = useState("");
  const [generando, setGenerando] = useState(false);
  const [ejecutando, setEjecutando] = useState(false);
  const [resultado, setResultado] = useState<QueryResult | null>(null);
  const [resultadoIdx, setResultadoIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generar = async (texto?: string) => {
    const promptUsar = texto ?? prompt;
    if (!promptUsar.trim()) return;
    setError(null);
    setGenerando(true);
    setConversacion((c) => [...c, { rol: "user", texto: promptUsar }]);
    setPrompt("");
    try {
      const r = await fetch("/api/v1/genie/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptUsar }),
      });
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error generando SQL");
        setConversacion((c) => c.slice(0, -1)); // rollback user message
        return;
      }
      const d = json.data;
      setConversacion((c) => [
        ...c,
        {
          rol: "genie",
          id: d.id,
          sql: d.sql,
          explicacion: d.explicacion,
          tokensInput: d.tokensInput,
          tokensOutput: d.tokensOutput,
          duracionMs: d.duracionMs,
          feedback: null,
        },
      ]);
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerando(false);
    }
  };

  const ejecutar = async (idx: number, sql: string) => {
    setError(null);
    setEjecutando(true);
    setResultado(null);
    setResultadoIdx(idx);
    try {
      const r = await fetch("/api/v1/sql/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sqlText: sql }),
      });
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error ejecutando SQL");
      } else {
        setResultado(json.data as QueryResult);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setEjecutando(false);
    }
  };

  const abrirEnWorkbench = (sql: string) => {
    // Pasar via sessionStorage para no ensuciar la URL con SQL largo
    sessionStorage.setItem("aibenchef.workbench.preload", sql);
    router.push("/dashboard/sql" as never);
  };

  const dar_feedback = async (id: number, idx: number, feedback: 1 | -1) => {
    setConversacion((c) =>
      c.map((m, i) => (i === idx && m.rol === "genie" ? { ...m, feedback } : m)),
    );
    try {
      await fetch("/api/v1/genie/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, feedback }),
      });
    } catch (e) {
      console.error("feedback failed", e);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-120px)]">
      {/* Columna izquierda: conversacion */}
      <div className="flex flex-col bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <header className="h-12 px-4 flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-violet-50 to-fuchsia-50">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-600" />
            <h2 className="text-sm font-semibold text-slate-900">Aiben</h2>
            <span className="text-[10px] text-slate-500">
              Pregunta en lenguaje natural, recibe SQL listo para ejecutar.
            </span>
          </div>
        </header>

        {/* Lista de mensajes / ejemplos iniciales */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {conversacion.length === 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">Prueba con uno de estos ejemplos:</p>
              {EJEMPLOS.map((ej) => (
                <button
                  key={ej}
                  type="button"
                  onClick={() => generar(ej)}
                  className="w-full text-left p-3 bg-slate-50 hover:bg-violet-50 border border-slate-200 hover:border-violet-300 rounded-lg text-sm text-slate-700 transition"
                >
                  <span className="text-violet-600 mr-1">→</span>
                  {ej}
                </button>
              ))}
            </div>
          ) : (
            conversacion.map((m, i) => {
              if (m.rol === "user") {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] bg-brand-600 text-white rounded-lg px-3 py-2 text-sm shadow-sm">
                      {m.texto}
                    </div>
                  </div>
                );
              }
              return (
                <div key={i} className="space-y-2">
                  <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                      <span className="text-xs font-semibold text-violet-900">Aiben</span>
                      <span className="text-[10px] text-slate-500 ml-auto">
                        {m.duracionMs}ms · {m.tokensInput + m.tokensOutput} tok
                      </span>
                    </div>
                    {m.explicacion && (
                      <p className="text-xs text-slate-700">{m.explicacion}</p>
                    )}
                    <pre className="text-[11.5px] font-mono bg-white border border-violet-100 rounded p-2 overflow-x-auto text-slate-800">
                      {m.sql}
                    </pre>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => ejecutar(i, m.sql)}
                        disabled={ejecutando}
                        className="inline-flex items-center gap-1 px-2 h-7 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-medium rounded"
                      >
                        <Play className="w-3 h-3" />
                        Ejecutar
                      </button>
                      <button
                        type="button"
                        onClick={() => abrirEnWorkbench(m.sql)}
                        className="inline-flex items-center gap-1 px-2 h-7 bg-white border border-slate-300 hover:bg-slate-50 text-xs font-medium rounded"
                      >
                        <ArrowRight className="w-3 h-3" />
                        Abrir en Workbench
                      </button>
                      <div className="flex items-center gap-1 ml-auto">
                        <button
                          type="button"
                          onClick={() => dar_feedback(m.id, i, 1)}
                          className={cn(
                            "p-1 rounded",
                            m.feedback === 1
                              ? "text-emerald-600"
                              : "text-slate-400 hover:text-slate-700",
                          )}
                          aria-label="Util"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => dar_feedback(m.id, i, -1)}
                          className={cn(
                            "p-1 rounded",
                            m.feedback === -1
                              ? "text-rose-600"
                              : "text-slate-400 hover:text-slate-700",
                          )}
                          aria-label="No util"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          {generando && (
            <div className="flex items-center gap-2 text-xs text-violet-700 p-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Aiben esta pensando...
            </div>
          )}
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
              {error}
            </div>
          )}
        </div>

        {/* Input prompt */}
        <div className="border-t border-slate-200 p-3 bg-slate-50">
          <div className="flex gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  generar();
                }
              }}
              placeholder="Preguntale a Aiben en lenguaje natural..."
              rows={2}
              className="flex-1 px-3 py-2 text-sm rounded border border-slate-300 focus:border-violet-500 outline-none resize-none"
            />
            <button
              type="button"
              onClick={() => generar()}
              disabled={generando || !prompt.trim()}
              className="px-4 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded inline-flex items-center gap-1"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Generar
            </button>
          </div>
          <p className="text-[10px] text-slate-500 mt-1">Enter para enviar, Shift+Enter para nueva linea.</p>
        </div>
      </div>

      {/* Columna derecha: resultado de ejecucion */}
      <div className="flex flex-col bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <header className="h-12 px-4 flex items-center justify-between border-b border-slate-200 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-900">Resultado</h2>
          {resultado && (
            <span className="text-[10px] text-slate-500">
              {formatNumber(resultado.totalFilas)} filas · {resultado.duracionMs}ms
            </span>
          )}
        </header>
        <div className="flex-1 overflow-auto p-4">
          {!resultado ? (
            <div className="flex flex-col items-center justify-center h-full text-sm text-slate-500 text-center">
              {ejecutando ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-violet-600 mb-2" />
                  Ejecutando...
                </>
              ) : (
                <p>Click 'Ejecutar' sobre un SQL generado para ver el resultado.</p>
              )}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  {resultado.columnas.map((c) => (
                    <th
                      key={c.key}
                      className="text-left px-2 py-1.5 font-semibold text-slate-600 font-mono whitespace-nowrap border-b border-slate-200"
                    >
                      {c.key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {resultado.filas.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {resultado.columnas.map((c) => {
                      const v = row[c.key];
                      return (
                        <td
                          key={c.key}
                          className={cn(
                            "px-2 py-1 whitespace-nowrap",
                            c.tipo === "number" && "text-right tabular-nums",
                          )}
                        >
                          {v === null || v === undefined
                            ? "—"
                            : typeof v === "number"
                              ? formatNumber(Number(v), 2)
                              : String(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
