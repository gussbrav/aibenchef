"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AgGridReact } from "ag-grid-react";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import { ClientSideRowModelModule, ModuleRegistry } from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { ArrowLeft, Check, Download, Loader2, Save, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";

import type { Sheet, SheetCells } from "@/lib/domains/sheets";

ModuleRegistry.registerModules([ClientSideRowModelModule]);

const COL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function colKey(idx: number): string {
  // Soporta hasta AZ (52 columnas)
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
  const pendingCellsRef = useRef<SheetCells>({});
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const colDefs = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [
      {
        headerName: "",
        valueGetter: (p) => (p.data as GridRow)?._row,
        width: 50,
        pinned: "left",
        editable: false,
        cellClass: "text-slate-500 text-center font-mono bg-slate-50",
        suppressMovable: true,
      },
    ];
    for (let c = 0; c < sheet.nCols; c++) {
      const letter = colKey(c);
      cols.push({
        headerName: letter,
        field: letter,
        editable: true,
        width: 110,
        cellEditor: "agTextCellEditor",
        cellClass: "text-slate-900",
      });
    }
    return cols;
  }, [sheet.nCols]);

  // Auto-save con debounce
  const persistCells = useCallback(async () => {
    if (Object.keys(pendingCellsRef.current).length === 0) return;
    setSaving(true);
    setError(null);
    const next: SheetCells = { ...sheet.cells, ...pendingCellsRef.current };
    // Limpiar celdas vacias (null o "")
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
  }, [sheet.id, sheet.cells]);

  const onCellChanged = (e: CellValueChangedEvent<GridRow>) => {
    const row = (e.data as GridRow)._row;
    const col = e.column.getColId();
    if (!col || col === "_row") return;
    const key = `${col}${row}`;
    const newVal = e.newValue;
    // Convertir a numero si parece numerico
    let v: string | number | boolean | null = newVal;
    if (typeof newVal === "string" && newVal.trim() !== "") {
      const n = Number(newVal.replace(/,/g, ""));
      if (Number.isFinite(n) && String(n) === newVal.replace(/,/g, "").trim()) {
        v = n;
      }
    }
    if (v === "" || v === undefined) v = null;
    pendingCellsRef.current[key] = v;

    // Debounce 800ms
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      persistCells();
    }, 800);
  };

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
    if (!confirm(`Eliminar la sheet "${sheet.nombre}"? Esta accion no se puede deshacer.`))
      return;
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
    // Header row con letras
    const headers = Array.from({ length: sheet.nCols }, (_, c) => colKey(c));
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    // Data rows
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
                Guardado {savedAt.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : (
              <span>Auto-save cada 800ms · Ctrl+S para guardar ya</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
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
            className="h-8 px-3 text-xs bg-white border border-slate-300 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 rounded inline-flex items-center gap-1"
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
          singleClickEdit
          stopEditingWhenCellsLoseFocus
          animateRows={false}
          headerHeight={28}
          rowHeight={28}
        />
      </div>
    </div>
  );
}
