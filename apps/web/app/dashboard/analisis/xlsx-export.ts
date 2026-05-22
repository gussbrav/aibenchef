/**
 * Export del resultado de pivot a XLSX con formato.
 *
 * Diseno:
 * - Hoja unica con encabezados pinteados
 * - Dimensiones a la izquierda con freeze panes
 * - Numeros con separador de miles, alineacion derecha
 * - Auto-ancho aproximado por columna
 * - Compatible con Excel / Google Sheets / Numbers
 */

import type { PivotResultado } from "./types";

export async function exportarAExcel(
  resultado: PivotResultado,
  options: { filename: string; hojaNombre?: string } = { filename: "pivot.xlsx" },
): Promise<void> {
  // Lazy import para que el bundle inicial no cargue exceljs (~700KB)
  const ExcelJS = (await import("exceljs")).default;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Aibenchef";
  workbook.created = new Date();

  const hoja = workbook.addWorksheet(options.hojaNombre ?? "Pivot", {
    views: [{ state: "frozen", xSplit: 0, ySplit: 1 }],
  });

  // Encabezados
  const headerRow = hoja.addRow(resultado.columnas.map((c) => c.label));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E40AF" },
    };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF1E3A8A" } },
    };
  });
  headerRow.height = 32;

  // Datos
  for (const fila of resultado.filas) {
    const valores = resultado.columnas.map((c) => fila[c.key] ?? null);
    const r = hoja.addRow(valores);
    r.eachCell((cell, colNumber) => {
      const colDef = resultado.columnas[colNumber - 1];
      if (!colDef) return;
      if (colDef.esNumerico) {
        cell.numFmt = "#,##0.00;[Red]-#,##0.00";
        cell.alignment = { horizontal: "right" };
      } else {
        cell.alignment = { horizontal: "left" };
      }
    });
  }

  // Auto-ancho aproximado: max(len label, max len valor por columna) +2
  hoja.columns.forEach((col, i) => {
    const colDef = resultado.columnas[i];
    if (!colDef) return;
    let max = colDef.label.length;
    for (const fila of resultado.filas) {
      const v = fila[colDef.key];
      if (v === null || v === undefined) continue;
      const s = colDef.esNumerico
        ? Number(v).toLocaleString("es-PE")
        : String(v);
      if (s.length > max) max = s.length;
    }
    col.width = Math.min(Math.max(max + 2, 10), 40);
  });

  // Congelar dimensiones a la izquierda
  const nDimensiones = resultado.columnas.filter((c) => c.tipo === "dimension").length;
  hoja.views = [{ state: "frozen", xSplit: nDimensiones, ySplit: 1 }];

  // Hoja con metadata
  const metaHoja = workbook.addWorksheet("_metadata");
  metaHoja.addRow(["Generado por", "Aibenchef Analisis Dinamico"]);
  metaHoja.addRow(["Fecha", new Date().toISOString()]);
  metaHoja.addRow(["Filas", resultado.totalFilas]);
  metaHoja.addRow(["Duracion query (ms)", resultado.duracionMs]);
  metaHoja.addRow(["Columnas", resultado.columnas.length]);
  metaHoja.state = "hidden";

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = options.filename;
  a.click();
  URL.revokeObjectURL(url);
}
