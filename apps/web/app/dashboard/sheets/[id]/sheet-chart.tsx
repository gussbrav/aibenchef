"use client";

/**
 * Renderer + editor de charts embebidos en una Sheet.
 *
 * - parseRange("A1:C10") -> { startCol, endCol, startRow, endRow }
 * - rangoToDataset(range, cells, headerRow, xColumn) -> { data, series }
 *   * data: array de { x, <serie>, ... }
 *   * series: nombres de cada serie (vienen del header si headerRow=true)
 * - <SheetChart> renderiza con recharts segun tipo (line/bar/area/pie)
 *
 * Paleta y formatos compartidos con [[informe color palette]] para que un
 * mismo benchmark se vea igual aca y en otros modulos.
 */

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { SheetCells, SheetChart as ChartDef } from "@/lib/domains/sheets";
import { evaluateFormula, type CellRawValue } from "./formula-engine";

const PALETTE = [
  "#2563eb",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
];

const COL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function colLetterToIdx(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function idxToColLetter(idx: number): string {
  let s = "";
  let i = idx + 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = COL_LETTERS[r]! + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

export type ParsedRange = {
  startColIdx: number;
  endColIdx: number;
  startRow: number;
  endRow: number;
};

export function parseRange(rango: string): ParsedRange | null {
  const m = rango.match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  const a = colLetterToIdx(m[1]!);
  const b = colLetterToIdx(m[3]!);
  const r1 = Number(m[2]);
  const r2 = Number(m[4]);
  return {
    startColIdx: Math.min(a, b),
    endColIdx: Math.max(a, b),
    startRow: Math.min(r1, r2),
    endRow: Math.max(r1, r2),
  };
}

type Dataset = {
  data: Array<Record<string, string | number>>;
  series: string[];
  xKey: string;
};

/**
 * Convierte un rango + celdas en un dataset listo para recharts.
 * - Si headerRow=true, primera fila del rango son los nombres de columna.
 * - xColumn define cual columna del rango es el eje X (las demas son series).
 */
export function rangoToDataset(
  rango: string,
  cells: SheetCells,
  headerRow: boolean,
  xColumn: string,
): Dataset | null {
  const r = parseRange(rango);
  if (!r) return null;

  const getRaw = (ref: string): CellRawValue => cells[ref];

  // Determinar columnas presentes en el rango
  const cols: { idx: number; letter: string }[] = [];
  for (let c = r.startColIdx; c <= r.endColIdx; c++) {
    cols.push({ idx: c, letter: idxToColLetter(c) });
  }
  const xIdx = colLetterToIdx(xColumn);
  // Si la xColumn no esta dentro del rango, usar la primera columna del rango.
  const effectiveXIdx = cols.find((c) => c.idx === xIdx) ? xIdx : r.startColIdx;
  const xLetter = idxToColLetter(effectiveXIdx);

  // Resolver nombres de columna (header) — caen al letter por default.
  const colNames: Record<string, string> = {};
  for (const c of cols) {
    let name = c.letter;
    if (headerRow && r.endRow > r.startRow) {
      const v = cells[`${c.letter}${r.startRow}`];
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        name = String(v);
      }
    }
    colNames[c.letter] = name;
  }

  const firstDataRow = headerRow && r.endRow > r.startRow ? r.startRow + 1 : r.startRow;

  const data: Array<Record<string, string | number>> = [];
  for (let row = firstDataRow; row <= r.endRow; row++) {
    const point: Record<string, string | number> = {};
    for (const c of cols) {
      const raw = getRaw(`${c.letter}${row}`);
      const evaluated = evaluateFormula(raw, getRaw);
      const value =
        typeof evaluated === "number"
          ? evaluated
          : evaluated === ""
            ? ""
            : Number.isFinite(Number(evaluated))
              ? Number(evaluated)
              : String(evaluated);
      const key = c.idx === effectiveXIdx ? "_x" : colNames[c.letter]!;
      point[key] = value;
    }
    // Saltar filas completamente vacias
    const hasAnyValue = Object.values(point).some(
      (v) => v !== "" && v !== null && v !== undefined,
    );
    if (hasAnyValue) data.push(point);
  }

  const series = cols
    .filter((c) => c.idx !== effectiveXIdx)
    .map((c) => colNames[c.letter]!);

  void xLetter;
  return { data, series, xKey: "_x" };
}

function formatValue(v: number, formato?: "number" | "percent" | "thousands"): string {
  if (!Number.isFinite(v)) return "";
  if (formato === "percent") {
    return new Intl.NumberFormat("es-PE", {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    }).format(v);
  }
  if (formato === "thousands") {
    return new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 }).format(v / 1000) + "k";
  }
  return new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 }).format(v);
}

export function SheetChart({
  chart,
  cells,
}: {
  chart: ChartDef;
  cells: SheetCells;
}) {
  const dataset = useMemo(
    () => rangoToDataset(chart.rango, cells, chart.headerRow, chart.xColumn),
    [chart.rango, chart.headerRow, chart.xColumn, cells],
  );

  if (!dataset) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-rose-700 bg-rose-50 rounded">
        Rango invalido: {chart.rango}
      </div>
    );
  }
  if (dataset.data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-500">
        Sin datos en {chart.rango}
      </div>
    );
  }

  const colores = chart.config.colores?.length ? chart.config.colores : PALETTE;
  const yFormatter = (v: number) => formatValue(v, chart.config.ejeY?.formato);
  const tipo = chart.tipo;

  // Render
  if (tipo === "pie") {
    // Para torta: cada fila del dataset es un slice; usamos la PRIMERA serie
    // como valor, y el _x como label.
    const valueKey = dataset.series[0];
    if (!valueKey) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-amber-700">
          Pie chart necesita al menos 1 columna de valores ademas del eje X.
        </div>
      );
    }
    const pieData = dataset.data.map((d, i) => ({
      name: String(d._x),
      value: Number(d[valueKey]) || 0,
      fill: colores[i % colores.length],
    }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            innerRadius={45}
            outerRadius={90}
            paddingAngle={1}
            label={(e: { name?: string }) => e.name ?? ""}
          >
            {pieData.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => yFormatter(Number(v))} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const xLabel = chart.config.ejeX?.titulo;
  const yLabel = chart.config.ejeY?.titulo;

  const CommonAxes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
      <XAxis
        dataKey={dataset.xKey}
        tick={{ fontSize: 11 }}
        label={xLabel ? { value: xLabel, position: "insideBottom", offset: -2 } : undefined}
      />
      <YAxis
        tick={{ fontSize: 11 }}
        tickFormatter={yFormatter}
        label={
          yLabel ? { value: yLabel, angle: -90, position: "insideLeft", offset: 10 } : undefined
        }
      />
      <Tooltip formatter={(v) => yFormatter(Number(v))} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
    </>
  );

  if (tipo === "line") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dataset.data} margin={{ top: 8, right: 16, bottom: 18, left: 8 }}>
          {CommonAxes}
          {dataset.series.map((s, i) => (
            <Line
              key={s}
              type="monotone"
              dataKey={s}
              stroke={colores[i % colores.length]!}
              strokeWidth={2}
              dot={{ r: 2 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (tipo === "area") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={dataset.data} margin={{ top: 8, right: 16, bottom: 18, left: 8 }}>
          {CommonAxes}
          {dataset.series.map((s, i) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stroke={colores[i % colores.length]!}
              fill={colores[i % colores.length]!}
              fillOpacity={0.3}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  // bar (default)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={dataset.data} margin={{ top: 8, right: 16, bottom: 18, left: 8 }}>
        {CommonAxes}
        {dataset.series.map((s, i) => (
          <Bar key={s} dataKey={s} fill={colores[i % colores.length]!} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
