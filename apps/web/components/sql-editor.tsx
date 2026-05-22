"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { OnMount } from "@monaco-editor/react";

// Monaco bundle es grande (~2MB). Lo cargamos solo client-side cuando hace falta.
const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center text-xs text-slate-500 bg-slate-50">
      Cargando editor...
    </div>
  ),
});

/**
 * Editor SQL con Monaco (mismo motor que VS Code).
 *
 * Features:
 *  - Syntax highlight (SQL Postgres dialect)
 *  - Autocomplete de tablas/columnas (via API /api/v1/catalog)
 *  - Ctrl/Cmd+Enter ejecuta query
 *  - Ctrl/Cmd+S guarda (callback)
 *  - Tema light pulido (alineado con el resto de la UI)
 *
 * Decision: NO usamos sqltools porque agrega dependencias pesadas.
 * El autocomplete lo construimos a mano con el catalog API que ya tenemos.
 */
export type SqlEditorProps = {
  value: string;
  onChange: (next: string) => void;
  onRun?: () => void;
  onSave?: () => void;
  height?: string | number;
  readOnly?: boolean;
};

export function SqlEditor({
  value,
  onChange,
  onRun,
  onSave,
  height = "100%",
  readOnly = false,
}: SqlEditorProps) {
  // Refs estables para handlers (evita re-registrar atajos en cada render)
  const onRunRef = useRef(onRun);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onRunRef.current = onRun;
    onSaveRef.current = onSave;
  }, [onRun, onSave]);

  const handleMount: OnMount = (editor, monaco) => {
    // Registrar atajos: Ctrl/Cmd+Enter para ejecutar, Ctrl/Cmd+S para guardar
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => onRunRef.current?.(),
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.();
    });

    // Configurar provider de autocomplete (lazy: pide al endpoint al primer trigger)
    let catalogCache: Array<{ schema: string; tabla: string }> | null = null;
    let columnasCache: Map<string, Array<{ nombre: string; tipo: string }>> = new Map();

    // Tipos de monaco no estan en @types — usamos any acotado donde haga falta.
    // Cualquier referencia a model/position viene tipada por el callback de monaco.
    monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: [".", " "],
      provideCompletionItems: async (
        model: { getLineContent: (n: number) => string; getValue: () => string; getWordUntilPosition: (p: { lineNumber: number; column: number }) => { startColumn: number; endColumn: number } },
        position: { lineNumber: number; column: number },
      ) => {
        const lineUntilPos = model
          .getLineContent(position.lineNumber)
          .slice(0, position.column - 1);
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        // Caso 1: usuario tipea "schema." -> sugerir tablas del schema
        const dotMatch = /(\w+)\.\s*$/.exec(lineUntilPos);
        if (dotMatch) {
          const schemaOrTabla = dotMatch[1]?.toLowerCase() ?? "";

          // Es schema? Cargar tablas
          if (!catalogCache) {
            try {
              const r = await fetch("/api/v1/catalog");
              const json = await r.json();
              if (json.data?.rows) catalogCache = json.data.rows;
            } catch {
              catalogCache = [];
            }
          }
          if (catalogCache && schemaOrTabla) {
            const tablas = catalogCache.filter(
              (t) => t.schema.toLowerCase() === schemaOrTabla,
            );
            if (tablas.length > 0) {
              return {
                suggestions: tablas.map((t) => ({
                  label: t.tabla,
                  kind: monaco.languages.CompletionItemKind.Class,
                  insertText: t.tabla,
                  range,
                  detail: `Table in ${t.schema}`,
                })),
              };
            }
          }

          // Es tabla.<algo>? Buscar columnas
          // Detectar tabla referenciada previamente en el texto (heuristica simple)
          const fullText = model.getValue();
          const match = new RegExp(`(\\w+)\\.${schemaOrTabla}\\b`, "i").exec(fullText);
          if (match) {
            const schema = match[1];
            const tabla = schemaOrTabla;
            const cacheKey = `${schema}.${tabla}`;
            if (!columnasCache.has(cacheKey)) {
              try {
                const r = await fetch(`/api/v1/catalog/${schema}/${tabla}`);
                const json = await r.json();
                if (json.data?.columnas) {
                  columnasCache.set(cacheKey, json.data.columnas);
                }
              } catch {
                /* swallow */
              }
            }
            const cols = columnasCache.get(cacheKey);
            if (cols) {
              return {
                suggestions: cols.map((c) => ({
                  label: c.nombre,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: c.nombre,
                  range,
                  detail: c.tipo,
                })),
              };
            }
          }
        }

        // Caso 2: keyword + schema globales
        const palabrasReservadas = [
          "SELECT",
          "FROM",
          "WHERE",
          "GROUP BY",
          "ORDER BY",
          "HAVING",
          "LIMIT",
          "JOIN",
          "INNER JOIN",
          "LEFT JOIN",
          "RIGHT JOIN",
          "FULL JOIN",
          "ON",
          "AND",
          "OR",
          "NOT",
          "IS NULL",
          "IS NOT NULL",
          "WITH",
          "AS",
          "UNION",
          "UNION ALL",
          "DISTINCT",
          "CASE",
          "WHEN",
          "THEN",
          "ELSE",
          "END",
          "SUM",
          "AVG",
          "MIN",
          "MAX",
          "COUNT",
          "COALESCE",
          "NULLIF",
          "BETWEEN",
          "IN",
        ];
        const schemas = ["marts", "dw"];
        return {
          suggestions: [
            ...palabrasReservadas.map((k) => ({
              label: k,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: k,
              range,
            })),
            ...schemas.map((s) => ({
              label: s,
              kind: monaco.languages.CompletionItemKind.Module,
              insertText: s,
              range,
              detail: "schema",
            })),
          ],
        };
      },
    });
  };

  return (
    <Editor
      height={height}
      defaultLanguage="sql"
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={handleMount}
      theme="vs-light"
      options={{
        fontSize: 13,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Menlo, Consolas, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        wrappingIndent: "indent",
        tabSize: 2,
        renderLineHighlight: "line",
        lineNumbersMinChars: 3,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
        readOnly,
        automaticLayout: true,
      }}
    />
  );
}
