/**
 * Formato condicional para celdas de AG Grid.
 *
 * Tipos soportados:
 *  - heatmap: gradiente de color min->max sobre los valores numericos de la columna
 *  - umbral: traffic light segun thresholds (bueno/malo)
 *
 * El cellStyle de AG Grid es una funcion (params) => style. Aqui generamos
 * esa funcion a partir de la configuracion guardada en el workspace + las
 * stats de la columna (min/max/mediana).
 */

import type { CellClassParams, CellStyle } from "ag-grid-community";

type CellStyleParams = CellClassParams;

export type FormatoCondicional =
  | {
      tipo: "heatmap";
      // Colores opcionales (default: rojo->verde via blanco)
      minColor?: string;
      maxColor?: string;
      // "invertido": valores ALTOS son MALOS (ej: ratio_mora)
      invertido?: boolean;
    }
  | {
      tipo: "umbral";
      bueno: number;
      malo: number;
      // invertido: bueno < umbral, malo > umbral
      invertido?: boolean;
    }
  | {
      tipo: "barras";
      maxAbs?: number;
    };

export type StatsColumna = {
  min: number;
  max: number;
  abs_max: number;
};

export function calcularStatsColumna(
  rows: Array<Record<string, unknown>>,
  key: string,
): StatsColumna {
  let min = Infinity;
  let max = -Infinity;
  let abs_max = 0;
  for (const row of rows) {
    const v = row[key];
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (n < min) min = n;
    if (n > max) max = n;
    const a = Math.abs(n);
    if (a > abs_max) abs_max = a;
  }
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 0;
  return { min, max, abs_max };
}

// Interpolacion lineal de color HEX
function lerpHex(c1: string, c2: string, t: number): string {
  const a = hexToRgb(c1);
  const b = hexToRgb(c2);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// Heatmap default: rojo (#fee5d9) -> verde (#3da659), via blanco (#f7fcf5)
const HEATMAP_MIN = "#fee5d9";
const HEATMAP_MAX = "#3da659";
const HEATMAP_MID = "#f7fcf5";

export function makeCellStyle(
  cfg: FormatoCondicional,
  stats: StatsColumna,
): (params: CellStyleParams) => CellStyle | null {
  if (cfg.tipo === "heatmap") {
    const minC = cfg.minColor ?? HEATMAP_MIN;
    const maxC = cfg.maxColor ?? HEATMAP_MAX;
    const invertido = cfg.invertido ?? false;
    const { min, max } = stats;
    if (min === max) return () => null;
    return (params) => {
      const v = Number(params.value);
      if (!Number.isFinite(v)) return null;
      let t = (v - min) / (max - min);
      if (invertido) t = 1 - t;
      // Tres tramos para dar mejor contraste (rojo - blanco - verde)
      const color =
        t < 0.5 ? lerpHex(minC, HEATMAP_MID, t * 2) : lerpHex(HEATMAP_MID, maxC, (t - 0.5) * 2);
      return { backgroundColor: color };
    };
  }
  if (cfg.tipo === "umbral") {
    const inv = cfg.invertido ?? false;
    return (params) => {
      const v = Number(params.value);
      if (!Number.isFinite(v)) return null;
      const esBueno = inv ? v <= cfg.bueno : v >= cfg.bueno;
      const esMalo = inv ? v >= cfg.malo : v <= cfg.malo;
      if (esBueno) return { color: "#047857", fontWeight: 500 };
      if (esMalo) return { color: "#be123c", fontWeight: 500 };
      return null;
    };
  }
  if (cfg.tipo === "barras") {
    const maxAbs = cfg.maxAbs ?? stats.abs_max;
    if (maxAbs <= 0) return () => null;
    return (params) => {
      const v = Number(params.value);
      if (!Number.isFinite(v)) return null;
      const pct = Math.min(100, (Math.abs(v) / maxAbs) * 100);
      const color = v >= 0 ? "rgba(59, 130, 246, 0.25)" : "rgba(244, 63, 94, 0.25)";
      return {
        background: `linear-gradient(to right, ${color} ${pct}%, transparent ${pct}%)`,
      };
    };
  }
  return () => null;
}
