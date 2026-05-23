"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AgGridReact } from "ag-grid-react";
import type {
  CellFocusedEvent,
  CellValueChangedEvent,
  ColDef,
  GridApi,
  GridReadyEvent,
} from "ag-grid-community";
import { ClientSideRowModelModule, ModuleRegistry } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import {
  ArrowLeft,
  Check,
  Download,
  Loader2,
  Save,
  Trash2,
  Upload,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/app/dashboard/_lib/format";

import type { Sheet, SheetCells } from "@/lib/domains/sheets";

import { evaluateFormula, type CellRawValue } from "./formula-engine";

ModuleRegistry.registerModules([ClientSideRowModelModule]);

const COL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function colKey(idx: number): string {
  if (idx < 26) return COL_LETTERS[idx]!;
  const first = Math.floor(idx / 26) - 1;
  const second = idx % 26;
  return `${COL_LETTERS[first]}${COL_LETTERS[second]}`;
}

type GridRow = { _row: number; [col: string]: string | number | boolean | null | undefined };

export function SheetEditor({ sheet: initial }: { sheet: Sheet }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(initial);
  const [nombre, setNombre] = useState(initial.nombre);
  const [editandoNombre, setEditandoNombre] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusedCell, setFocusedCell] = useState<{
    cellRef: string;
    value: string | number | boolean | null | undefined;
  } | null>(null);
  const pendingCellsRef = useRef<SheetCells>({});
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridApiRef = useRef<GridApi | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Construir rowData desde el JSONB sparse
  const rowData = useMemo<GridRow[]>(() => {
    const rows: GridRow[] = [];
    for (let r = 1; r <= sheet.nRows; r++) {
      const row: GridRow = { _row: r };
      for (let c = 0; c < sheet.nCols; c++) {
        const key = `${colKey(c)}${r}`;
        const v = sheet.cells[key];
        if (v !== undefined) row[colKey(c)] = v;
      }
      rows.push(row);
    }
    return rows;
  }, [sheet]);

  // Lookup function para el evaluador de formulas — busca por celda key (ej "A1")
  // en el cells JSONB sparse.
  const getCellRaw = useCallback(
    (ref: string): CellRawValue => sheet.cells[ref],
    [sheet.cells],
  );

  const colDefs = useMemo<ColDef[]>(() => {
    // Width dinamico del numero de fila: 1-9 -> 36, 10-99 -> 44,
    // 100-999 -> 52, 1000-9999 -> 60, 10000+ -> 68
    const digits = String(sheet.nRows).length;
    const rowIndexWidth = 28 + digits * 8;
    const cols: ColDef[] = [
      {
        headerName: "",
        valueGetter: (p) => (p.data as GridRow)?._row,
        width: rowIndexWidth,
        pinned: "left",
        editable: false,
        cellStyle: { textAlign: "center" },
        suppressMovable: true,
        sortable: false,
        resizable: false,
        lockPosition: "left",
      },
    ];
    for (let c = 0; c < sheet.nCols; c++) {
      const letter = colKey(c);
      cols.push({
        headerName: letter,
        field: letter,
        editable: true,
        width: 92,
        cellEditor: "agTextCellEditor",
        headerClass: "ag-center-header",
        // valueFormatter evalua formulas para DISPLAY. El raw value (con "=") se
        // mantiene en data para que al editar se vea la formula original.
        valueFormatter: (p) => {
          const v = p.value as CellRawValue;
          if (v === null || v === undefined || v === "") return "";
          if (typeof v === "string" && v.trimStart().startsWith("=")) {
            const result = evaluateFormula(v, getCellRaw);
            if (typeof result === "number") {
              // Numero: mostrar con formato. Si es entero, sin decimales.
              return Number.isInteger(result)
                ? String(result)
                : formatNumber(result, 4).replace(/0+$/, "").replace(/\.$/, "");
            }
            return String(result);
          }
          return String(v);
        },
        cellClass: (p) => {
          const v = p.value as CellRawValue;
          if (typeof v === "string" && v.trimStart().startsWith("=")) {
            return "text-emerald-700 tabular-nums";
          }
          if (typeof v === "number") return "tabular-nums text-right";
          return "";
        },
      });
    }
    return cols;
  }, [sheet.nCols, sheet.nRows, getCellRaw]);

  // Auto-scroll a A1 al cargar
  const onGridReady = useCallback((params: GridReadyEvent) => {
    gridApiRef.current = params.api;
    // Posicionar la primera celda visible
    setTimeout(() => {
      params.api.ensureIndexVisible(0, "top");
      params.api.ensureColumnVisible(colKey(0));
      // Foco en A1
      params.api.setFocusedCell(0, colKey(0));
    }, 50);
  }, []);

  // Auto-save con debounce
  const persistCells = useCallback(
    async (extraCells?: SheetCells) => {
      const cellsToSave = { ...pendingCellsRef.current, ...(extraCells ?? {}) };
      if (Object.keys(cellsToSave).length === 0) return;
      setSaving(true);
      setError(null);
      const next: SheetCells = { ...sheet.cells, ...cellsToSave };
      // Limpiar celdas vacias
      for (const k of Object.keys(next)) {
        const v = next[k];
        if (v === null || v === undefined || v === "") delete next[k];
      }
      try {
        const r = await fetch(`/api/v1/sheets/${sheet.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cells: next }),
        });
        const json = await r.json();
        if (json.error) {
          setError(json.error.message ?? "Error guardando");
        } else {
          setSheet(json.data as Sheet);
          pendingCellsRef.current = {};
          setSavedAt(new Date());
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setSaving(false);
      }
    },
    [sheet.id, sheet.cells],
  );

  const onCellChanged = (e: CellValueChangedEvent<GridRow>) => {
    const row = (e.data as GridRow)._row;
    const col = e.column.getColId();
    if (!col || col === "_row") return;
    const key = `${col}${row}`;
    const newVal = e.newValue;
    // Convertir a numero si parece numerico. EXCEPCION: si empieza con "=" lo
    // mantenemos como string (es una formula y se evalua en valueFormatter).
    let v: string | number | boolean | null = newVal;
    if (typeof newVal === "string" && newVal.trim() !== "") {
      const trimmed = newVal.trim();
      if (!trimmed.startsWith("=")) {
        const n = Number(trimmed.replace(/,/g, ""));
        if (Number.isFinite(n) && String(n) === trimmed.replace(/,/g, "")) {
          v = n;
        }
      }
    }
    if (v === "" || v === undefined) v = null;
    pendingCellsRef.current[key] = v;

    // Auto-grow: si el usuario esta editando la ultima fila o columna,
    // crece la grilla automaticamente (+10 filas o +3 cols) para evitar
    // necesidad de boton manual.
    const colIdxEditado = colKey(sheet.nCols - 1) === col
      ? sheet.nCols - 1
      : -1;
    const esUltimaFila = row >= sheet.nRows;
    const esUltimaCol = colIdxEditado >= 0 && row > 0;
    if (esUltimaFila || esUltimaCol) {
      const nuevoNRows = esUltimaFila ? Math.min(sheet.nRows + 10, 10000) : undefined;
      const nuevoNCols = esUltimaCol ? Math.min(sheet.nCols + 3, 100) : undefined;
      // Persistir en background sin esperar (autosave se ocupa)
      void (async () => {
        try {
          const body: Record<string, unknown> = {};
          if (nuevoNRows !== undefined) body.nRows = nuevoNRows;
          if (nuevoNCols !== undefined) body.nCols = nuevoNCols;
          if (Object.keys(body).length === 0) return;
          const r = await fetch(`/api/v1/sheets/${sheet.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const json = await r.json();
          if (json.data) setSheet(json.data as Sheet);
        } catch (err) {
          console.error("Auto-grow failed", err);
        }
      })();
    }

    // Debounce 800ms
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      persistCells();
    }, 800);
  };

  // Track focused cell para mostrar en status bar (Community-safe).
  // Selection multi-celda con stats requiere AG Grid Enterprise (cellSelection).
  const onCellFocused = useCallback((e: CellFocusedEvent) => {
    const rowIndex = e.rowIndex;
    const colId = e.column && typeof e.column === "object" ? e.column.getColId() : null;
    if (rowIndex === null || rowIndex === undefined || !colId || colId === "_row") {
      setFocusedCell(null);
      return;
    }
    const node = e.api.getDisplayedRowAtIndex(rowIndex);
    if (!node) {
      setFocusedCell(null);
      return;
    }
    const row = (node.data as GridRow)._row;
    const v = (node.data as GridRow)[colId];
    setFocusedCell({ cellRef: `${colId}${row}`, value: v });
  }, []);

  const guardarYa = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    persistCells();
  };

  // Cmd/Ctrl+S guarda manual
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        guardarYa();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.cells]);

  const renombrar = async () => {
    if (!nombre.trim() || nombre === sheet.nombre) {
      setEditandoNombre(false);
      return;
    }
    try {
      const r = await fetch(`/api/v1/sheets/${sheet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim() }),
      });
      const json = await r.json();
      if (json.data) setSheet(json.data as Sheet);
      setEditandoNombre(false);
    } catch (e) {
      setError(String(e));
    }
  };

  const eliminar = async () => {
    if (!confirm(`Eliminar la sheet "${sheet.nombre}"?`)) return;
    try {
      await fetch(`/api/v1/sheets/${sheet.id}`, { method: "DELETE" });
      router.push("/dashboard/sheets" as never);
    } catch (e) {
      setError(String(e));
    }
  };

  const exportXlsx = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Aibenchef";
    const ws = wb.addWorksheet(sheet.nombre);
    const headers = Array.from({ length: sheet.nCols }, (_, c) => colKey(c));
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    for (let r = 1; r <= sheet.nRows; r++) {
      const row = Array.from({ length: sheet.nCols }, (_, c) => {
        const k = `${colKey(c)}${r}`;
        return sheet.cells[k] ?? null;
      });
      ws.addRow(row);
    }
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sheet.nombre}_${Date.now()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import XLSX desde archivo del usuario
  const importXlsx = async (file: File) => {
    setError(null);
    setSaving(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const buffer = await file.arrayBuffer();
      await wb.xlsx.load(buffer);
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("Archivo XLSX sin hojas");
      const newCells: SheetCells = {};
      let maxRow = 0;
      let maxCol = 0;
      ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const letter = colKey(colNumber - 1);
          const key = `${letter}${rowNumber}`;
          const v = cell.value;
          if (v === null || v === undefined) return;
          if (typeof v === "object") {
            // ExcelJS cell value puede ser { text, hyperlink, formula, result, etc }
            // o un Date. Aplanamos a primitivo.
            if (v instanceof Date) {
              newCells[key] = v.toISOString();
            } else {
              const fv = v as unknown as Record<string, unknown>;
              const flat =
                fv.result ?? fv.text ?? fv.formula ?? fv.hyperlink ?? JSON.stringify(v);
              newCells[key] = flat as string | number | boolean | null;
            }
          } else {
            newCells[key] = v as string | number | boolean | null;
          }
          if (rowNumber > maxRow) maxRow = rowNumber;
          if (colNumber > maxCol) maxCol = colNumber;
        });
      });
      await persistCells(newCells);
      setSavedAt(new Date());
    } catch (e) {
      setError(`Error importando XLSX: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <header className="flex items-center justify-between gap-3 px-2 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => router.push("/dashboard/sheets" as never)}
            className="text-slate-500 hover:text-slate-900 p-1 -ml-1"
            aria-label="Volver"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          {editandoNombre ? (
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onBlur={renombrar}
              onKeyDown={(e) => {
                if (e.key === "Enter") renombrar();
                if (e.key === "Escape") {
                  setNombre(sheet.nombre);
                  setEditandoNombre(false);
                }
              }}
              autoFocus
              className="text-xl font-bold text-slate-900 bg-white border border-brand-300 rounded px-2 py-0.5 outline-none flex-1 max-w-md"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditandoNombre(true)}
              className="text-xl font-bold text-slate-900 hover:bg-slate-100 rounded px-2 py-0.5 truncate text-left"
              title="Click para renombrar"
            >
              {sheet.nombre}
            </button>
          )}
          <span className="text-[10px] text-slate-500 ml-2">
            {saving ? (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <Loader2 className="w-3 h-3 animate-spin" />
                Guardando...
              </span>
            ) : savedAt ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <Check className="w-3 h-3" />
                Guardado{" "}
                {savedAt.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : (
              <span>Auto-save · Ctrl+S</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                importXlsx(f);
                e.target.value = "";
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-8 px-2 text-xs bg-white border border-slate-300 hover:bg-slate-50 rounded inline-flex items-center gap-1"
            title="Importar XLSX"
          >
            <Upload className="w-3.5 h-3.5" />
            Importar
          </button>
          <button
            type="button"
            onClick={guardarYa}
            disabled={saving}
            className="h-8 px-3 text-xs bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded inline-flex items-center gap-1"
          >
            <Save className="w-3.5 h-3.5" />
            Guardar
          </button>
          <button
            type="button"
            onClick={exportXlsx}
            className="h-8 px-3 text-xs bg-white border border-slate-300 hover:bg-slate-50 rounded inline-flex items-center gap-1"
          >
            <Download className="w-3.5 h-3.5" />
            XLSX
          </button>
          <button
            type="button"
            onClick={eliminar}
            className="h-8 px-2 text-xs bg-white border border-slate-300 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 rounded inline-flex items-center"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {error && (
        <div className="mx-2 mb-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
          {error}
        </div>
      )}

      <div className={cn("flex-1 ag-theme-quartz mx-2 border border-slate-200 rounded")}>
        <AgGridReact
          rowData={rowData}
          columnDefs={colDefs}
          defaultColDef={{
            resizable: true,
            sortable: false,
            filter: false,
          }}
          onCellValueChanged={onCellChanged}
          onCellFocused={onCellFocused}
          onGridReady={onGridReady}
          singleClickEdit
          stopEditingWhenCellsLoseFocus
          animateRows={false}
          headerHeight={24}
          rowHeight={24}
          enterNavigatesVertically
          enterNavigatesVerticallyAfterEdit
        />
      </div>

      {/* Status bar tipo Excel (single-cell focus en Community) */}
      <footer className="mx-2 mt-1 px-3 h-7 bg-slate-50 border border-slate-200 rounded flex items-center gap-4 text-[11px] text-slate-600">
        <span>
          <span className="font-mono text-slate-500 mr-1">Grilla:</span>
          {sheet.nRows}×{sheet.nCols}
        </span>
        <div className="w-px h-3 bg-slate-300" />
        <span>
          <span className="font-mono text-slate-500 mr-1">Con datos:</span>
          {Object.keys(sheet.cells).length}
        </span>
        {focusedCell && (
          <>
            <div className="w-px h-3 bg-slate-300" />
            <span>
              <span className="font-mono text-slate-500 mr-1">Celda:</span>
              <span className="font-mono font-semibold text-slate-800">{focusedCell.cellRef}</span>
            </span>
            {focusedCell.value !== null && focusedCell.value !== undefined && focusedCell.value !== "" && (
              <>
                {typeof focusedCell.value === "string" && focusedCell.value.trimStart().startsWith("=") ? (
                  // Formula: mostrar formula + resultado evaluado
                  <>
                    <span className="truncate max-w-xs">
                      <span className="font-mono text-slate-500 mr-1">Formula:</span>
                      <span className="font-mono text-emerald-700">{String(focusedCell.value)}</span>
                    </span>
                    <span className="truncate max-w-xs">
                      <span className="font-mono text-slate-500 mr-1">=</span>
                      {(() => {
                        const r = evaluateFormula(focusedCell.value as string, getCellRaw);
                        return typeof r === "number"
                          ? <span className="tabular-nums font-semibold">{formatNumber(r, 2)}</span>
                          : <span className="text-rose-600">{String(r)}</span>;
                      })()}
                    </span>
                  </>
                ) : (
                  <span className="truncate max-w-md">
                    <span className="font-mono text-slate-500 mr-1">Valor:</span>
                    {typeof focusedCell.value === "number"
                      ? <span className="tabular-nums">{formatNumber(focusedCell.value, 2)}</span>
                      : <span>{String(focusedCell.value)}</span>}
                  </span>
                )}
              </>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
