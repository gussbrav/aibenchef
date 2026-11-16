"use client";

/**
 * Matriz de Trayectoria — visualización SVG que muestra:
 *   - Posición actual de cada entidad en un plano 2D (ejeX × ejeY).
 *   - Flecha desde su posición hace _ventanaMeses_ a la posición actual.
 *   - 4 cuadrantes definidos por la mediana del sector (no por cero absoluto).
 *     Esto hace la lectura RELATIVA al peer group, más accionable que valores
 *     absolutos (ej: ROE 5% puede ser "bueno" para N3 pero "malo" para bancos).
 *
 * Diseño:
 *   - SVG puro (sin recharts/d3) para control total sobre flechas y cuadrantes.
 *   - Tooltip custom en hover (sin dependencia externa).
 *   - Dot sizing por patrimonio → las entidades grandes son visualmente dominantes.
 *   - Cuadrante "bueno" vs "malo" se determina por EJE_ALTO_ES_BUENO.
 *
 * Ejes:
 *   - EJE_ALTO_ES_BUENO[eje]=true  → alto = mejor (ROE, ROA, Cobertura).
 *   - EJE_ALTO_ES_BUENO[eje]=false → alto = peor (Mora).
 *   El cuadrante "ideal" es siempre el que tiene AMBOS ejes del lado bueno.
 */

import { useMemo, useState } from "react";
import type {
  EjeMetrica,
  TrayectoriaEntidad,
} from "@/lib/domains/estadisticas-rapidas/types";
import {
  EJE_ALTO_ES_BUENO,
  LABEL_EJE,
} from "@/lib/domains/estadisticas-rapidas/types";
import { formatPct, formatNumberCompact } from "@/app/dashboard/_lib/format";

// ============================================================================
// Config visual
// ============================================================================

const WIDTH = 900;
const HEIGHT = 560;
const PAD = { top: 40, right: 40, bottom: 60, left: 70 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

const DOT_MIN_R = 4;
const DOT_MAX_R = 18;

// Paleta por cuadrante (fondo muy sutil, borde al centro de cada cuadrante).
// bueno-bueno = verde, malo-malo = rojo, los cruzados = amarillo/ámbar.
const COLOR_QUAD_IDEAL = "rgba(16, 185, 129, 0.08)";   // emerald/500 8%
const COLOR_QUAD_MIXED = "rgba(245, 158, 11, 0.06)";   // amber/500 6%
const COLOR_QUAD_BAD   = "rgba(239, 68, 68, 0.08)";    // red/500 8%
const COLOR_MEDIAN_LINE = "#CBD5E1";                    // slate-300
const COLOR_AXIS = "#94A3B8";                           // slate-400
const COLOR_DOT_DEFAULT = "#0F172A";                    // slate-900
const COLOR_ARROW_IMPROVE = "#059669";                  // emerald-600
const COLOR_ARROW_DECLINE = "#DC2626";                  // red-600
const COLOR_ARROW_NEUTRAL = "#94A3B8";                  // slate-400

// ============================================================================
// Helpers
// ============================================================================

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function pad(min: number, max: number, padPct = 0.1): [number, number] {
  const range = max - min || Math.abs(max) || 1;
  const p = range * padPct;
  return [min - p, max + p];
}

function esMovimientoMejora(
  xPrev: number, yPrev: number,
  xAct: number, yAct: number,
  altoBuenoX: boolean, altoBuenoY: boolean,
): "mejora" | "deterioro" | "neutro" {
  const dX = (xAct - xPrev) * (altoBuenoX ? 1 : -1);
  const dY = (yAct - yPrev) * (altoBuenoY ? 1 : -1);
  const score = dX + dY;
  if (Math.abs(score) < 0.005) return "neutro"; // < 0.5pp combinado
  return score > 0 ? "mejora" : "deterioro";
}

// ============================================================================
// Props
// ============================================================================

type Props = {
  data: TrayectoriaEntidad[];
  ejeX: EjeMetrica;
  ejeY: EjeMetrica;
  ventanaMeses: number;
  onChangeEje?: (eje: "x" | "y", metrica: EjeMetrica) => void;
  onChangeVentana?: (ventanaMeses: number) => void;
};

// ============================================================================
// Componente
// ============================================================================

export function TrajectoryMatrix({
  data,
  ejeX,
  ejeY,
  ventanaMeses,
  onChangeEje,
  onChangeVentana,
}: Props) {
  const [hover, setHover] = useState<TrayectoriaEntidad | null>(null);

  // Escalas + medianas (definen cuadrantes).
  const {
    scaleX, scaleY, medianX, medianY, altoBuenoX, altoBuenoY, xMinMax, yMinMax,
  } = useMemo(() => {
    const xs = data.map((d) => d.x_actual);
    const ys = data.map((d) => d.y_actual);
    const [xMin, xMax] = pad(Math.min(...xs), Math.max(...xs));
    const [yMin, yMax] = pad(Math.min(...ys), Math.max(...ys));

    const scaleX = (v: number) =>
      PAD.left + ((v - xMin) / (xMax - xMin)) * PLOT_W;
    const scaleY = (v: number) =>
      PAD.top + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;

    return {
      scaleX,
      scaleY,
      medianX: median(xs),
      medianY: median(ys),
      altoBuenoX: EJE_ALTO_ES_BUENO[ejeX],
      altoBuenoY: EJE_ALTO_ES_BUENO[ejeY],
      xMinMax: [xMin, xMax] as [number, number],
      yMinMax: [yMin, yMax] as [number, number],
    };
  }, [data, ejeX, ejeY]);

  // Dot sizing basado en peso (patrimonio).
  const scaleRadius = useMemo(() => {
    const pesos = data.map((d) => d.peso ?? 0).filter((p) => p > 0);
    if (pesos.length === 0) return () => DOT_MIN_R;
    const maxP = Math.max(...pesos);
    return (p: number | null) => {
      if (p == null || p <= 0) return DOT_MIN_R;
      // Escala sqrt para que el ÁREA (no el radio) sea proporcional al peso.
      return DOT_MIN_R + (DOT_MAX_R - DOT_MIN_R) * Math.sqrt(p / maxP);
    };
  }, [data]);

  // Ticks del eje (5 valores equidistantes).
  const xTicks = useMemo(() => {
    const [a, b] = xMinMax;
    return Array.from({ length: 5 }, (_, i) => a + ((b - a) * i) / 4);
  }, [xMinMax]);
  const yTicks = useMemo(() => {
    const [a, b] = yMinMax;
    return Array.from({ length: 5 }, (_, i) => a + ((b - a) * i) / 4);
  }, [yMinMax]);

  // Cuadrantes: calculamos los 4 rectángulos y asignamos color por semántica.
  const quadrants = useMemo(() => {
    const mx = scaleX(medianX);
    const my = scaleY(medianY);
    // Esquina "buena" en X depende de altoBuenoX. Idem Y.
    // altoBuenoX=true → buena = derecha (x > mediana), mala = izquierda.
    // altoBuenoY=true → buena = arriba (y > mediana, pero scaleY invierte → y_pixel < my).
    const quads = [
      { // Top-Left
        x: PAD.left, y: PAD.top, w: mx - PAD.left, h: my - PAD.top,
        esBuenoX: !altoBuenoX, esBuenoY: true,
        label: label("TL", altoBuenoX, altoBuenoY),
      },
      { // Top-Right
        x: mx, y: PAD.top, w: PAD.left + PLOT_W - mx, h: my - PAD.top,
        esBuenoX: altoBuenoX, esBuenoY: true,
        label: label("TR", altoBuenoX, altoBuenoY),
      },
      { // Bottom-Left
        x: PAD.left, y: my, w: mx - PAD.left, h: PAD.top + PLOT_H - my,
        esBuenoX: !altoBuenoX, esBuenoY: false,
        label: label("BL", altoBuenoX, altoBuenoY),
      },
      { // Bottom-Right
        x: mx, y: my, w: PAD.left + PLOT_W - mx, h: PAD.top + PLOT_H - my,
        esBuenoX: altoBuenoX, esBuenoY: false,
        label: label("BR", altoBuenoX, altoBuenoY),
      },
    ];
    return quads.map((q) => ({
      ...q,
      color:
        q.esBuenoX && q.esBuenoY ? COLOR_QUAD_IDEAL :
        !q.esBuenoX && !q.esBuenoY ? COLOR_QUAD_BAD :
        COLOR_QUAD_MIXED,
    }));
  }, [altoBuenoX, altoBuenoY, medianX, medianY, scaleX, scaleY]);

  const METRICS: EjeMetrica[] = ["roe", "roa", "mora", "cobertura"];
  const VENTANAS = [3, 6, 12];

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 text-slate-500">
          <span className="font-medium">Eje X:</span>
          <select
            value={ejeX}
            onChange={(e) => onChangeEje?.("x", e.target.value as EjeMetrica)}
            className="border border-slate-200 rounded-md px-2 py-1 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {METRICS.filter((m) => m !== ejeY).map((m) => (
              <option key={m} value={m}>{LABEL_EJE[m]}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-slate-500">
          <span className="font-medium">Eje Y:</span>
          <select
            value={ejeY}
            onChange={(e) => onChangeEje?.("y", e.target.value as EjeMetrica)}
            className="border border-slate-200 rounded-md px-2 py-1 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {METRICS.filter((m) => m !== ejeX).map((m) => (
              <option key={m} value={m}>{LABEL_EJE[m]}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-slate-500">
          <span className="font-medium">Comparar vs:</span>
          <select
            value={ventanaMeses}
            onChange={(e) => onChangeVentana?.(Number(e.target.value))}
            className="border border-slate-200 rounded-md px-2 py-1 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {VENTANAS.map((m) => (
              <option key={m} value={m}>{m} meses atrás</option>
            ))}
          </select>
        </label>
        <div className="text-slate-400 ml-auto">
          {data.length} entidades · tamaño ∝ patrimonio
        </div>
      </div>

      {/* SVG */}
      <div className="relative bg-white rounded-xl border border-slate-200 overflow-hidden">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full h-auto"
          role="img"
          aria-label="Matriz de trayectoria de entidades"
        >
          <defs>
            <marker
              id="arrow-improve" viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={COLOR_ARROW_IMPROVE} />
            </marker>
            <marker
              id="arrow-decline" viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={COLOR_ARROW_DECLINE} />
            </marker>
            <marker
              id="arrow-neutral" viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={COLOR_ARROW_NEUTRAL} />
            </marker>
          </defs>

          {/* Cuadrantes de fondo */}
          {quadrants.map((q, i) => (
            <g key={i}>
              <rect x={q.x} y={q.y} width={q.w} height={q.h} fill={q.color} />
              <text
                x={q.x + q.w / 2}
                y={q.y + 18}
                textAnchor="middle"
                className="fill-slate-400 text-[10px] font-semibold uppercase tracking-wider"
                style={{ pointerEvents: "none" }}
              >
                {q.label}
              </text>
            </g>
          ))}

          {/* Líneas de mediana (divisores de cuadrantes) */}
          <line
            x1={scaleX(medianX)} y1={PAD.top}
            x2={scaleX(medianX)} y2={PAD.top + PLOT_H}
            stroke={COLOR_MEDIAN_LINE} strokeWidth={1} strokeDasharray="4 4"
          />
          <line
            x1={PAD.left} y1={scaleY(medianY)}
            x2={PAD.left + PLOT_W} y2={scaleY(medianY)}
            stroke={COLOR_MEDIAN_LINE} strokeWidth={1} strokeDasharray="4 4"
          />

          {/* Ejes */}
          <line
            x1={PAD.left} y1={PAD.top + PLOT_H}
            x2={PAD.left + PLOT_W} y2={PAD.top + PLOT_H}
            stroke={COLOR_AXIS} strokeWidth={1}
          />
          <line
            x1={PAD.left} y1={PAD.top}
            x2={PAD.left} y2={PAD.top + PLOT_H}
            stroke={COLOR_AXIS} strokeWidth={1}
          />

          {/* X ticks */}
          {xTicks.map((t, i) => (
            <g key={`xt-${i}`}>
              <line
                x1={scaleX(t)} y1={PAD.top + PLOT_H}
                x2={scaleX(t)} y2={PAD.top + PLOT_H + 4}
                stroke={COLOR_AXIS}
              />
              <text
                x={scaleX(t)} y={PAD.top + PLOT_H + 18}
                textAnchor="middle"
                className="fill-slate-500 text-[10px] tabular-nums"
              >
                {formatPct(t)}
              </text>
            </g>
          ))}

          {/* Y ticks */}
          {yTicks.map((t, i) => (
            <g key={`yt-${i}`}>
              <line
                x1={PAD.left - 4} y1={scaleY(t)}
                x2={PAD.left} y2={scaleY(t)}
                stroke={COLOR_AXIS}
              />
              <text
                x={PAD.left - 8} y={scaleY(t) + 3}
                textAnchor="end"
                className="fill-slate-500 text-[10px] tabular-nums"
              >
                {formatPct(t)}
              </text>
            </g>
          ))}

          {/* Labels de ejes */}
          <text
            x={PAD.left + PLOT_W / 2}
            y={HEIGHT - 12}
            textAnchor="middle"
            className="fill-slate-700 text-xs font-semibold"
          >
            {LABEL_EJE[ejeX]} {altoBuenoX ? "→ mayor = mejor" : "← menor = mejor"}
          </text>
          <text
            transform={`rotate(-90 ${18} ${PAD.top + PLOT_H / 2})`}
            x={18}
            y={PAD.top + PLOT_H / 2}
            textAnchor="middle"
            className="fill-slate-700 text-xs font-semibold"
          >
            {LABEL_EJE[ejeY]} {altoBuenoY ? "↑ mayor = mejor" : "↓ menor = mejor"}
          </text>

          {/* Flechas (behind dots) */}
          {data.map((d) => {
            if (d.x_prev == null || d.y_prev == null) return null;
            const x1 = scaleX(d.x_prev);
            const y1 = scaleY(d.y_prev);
            const x2 = scaleX(d.x_actual);
            const y2 = scaleY(d.y_actual);
            const dist = Math.hypot(x2 - x1, y2 - y1);
            if (dist < 3) return null; // sin movimiento visible
            const tipo = esMovimientoMejora(
              d.x_prev, d.y_prev, d.x_actual, d.y_actual, altoBuenoX, altoBuenoY,
            );
            const color =
              tipo === "mejora" ? COLOR_ARROW_IMPROVE :
              tipo === "deterioro" ? COLOR_ARROW_DECLINE :
              COLOR_ARROW_NEUTRAL;
            const marker =
              tipo === "mejora" ? "url(#arrow-improve)" :
              tipo === "deterioro" ? "url(#arrow-decline)" :
              "url(#arrow-neutral)";
            return (
              <line
                key={`arr-${d.nomb_correg}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={color} strokeWidth={1.3} strokeOpacity={0.55}
                markerEnd={marker}
                style={{ pointerEvents: "none" }}
              />
            );
          })}

          {/* Dots (current position) */}
          {data.map((d) => {
            const cx = scaleX(d.x_actual);
            const cy = scaleY(d.y_actual);
            const r = scaleRadius(d.peso);
            const isHover = hover?.nomb_correg === d.nomb_correg;
            return (
              <circle
                key={`dot-${d.nomb_correg}`}
                cx={cx} cy={cy} r={r}
                fill={COLOR_DOT_DEFAULT}
                fillOpacity={isHover ? 0.95 : 0.65}
                stroke="white" strokeWidth={1.5}
                className="cursor-pointer transition-opacity"
                onMouseEnter={() => setHover(d)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{d.nomb_correg}</title>
              </circle>
            );
          })}
        </svg>

        {/* Tooltip overlay */}
        {hover && (
          <div className="absolute top-3 right-3 bg-white border border-slate-200 rounded-lg shadow-lg px-3.5 py-2.5 text-xs min-w-[220px] max-w-[280px] pointer-events-none">
            <div className="font-semibold text-slate-900 mb-1.5">
              {hover.nomb_correg}
            </div>
            <div className="space-y-0.5 text-slate-600">
              <div className="flex justify-between gap-3">
                <span>{LABEL_EJE[ejeX]} actual:</span>
                <span className="font-medium tabular-nums text-slate-900">
                  {formatPct(hover.x_actual)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span>{LABEL_EJE[ejeY]} actual:</span>
                <span className="font-medium tabular-nums text-slate-900">
                  {formatPct(hover.y_actual)}
                </span>
              </div>
              {hover.x_prev != null && hover.y_prev != null && (
                <div className="pt-1 mt-1 border-t border-slate-100">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
                    Hace {ventanaMeses} meses
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>{LABEL_EJE[ejeX]}:</span>
                    <span className="tabular-nums">
                      {formatPct(hover.x_prev)}
                      <span className="text-slate-400 ml-1">
                        ({delta(hover.x_prev, hover.x_actual, altoBuenoX)})
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>{LABEL_EJE[ejeY]}:</span>
                    <span className="tabular-nums">
                      {formatPct(hover.y_prev)}
                      <span className="text-slate-400 ml-1">
                        ({delta(hover.y_prev, hover.y_actual, altoBuenoY)})
                      </span>
                    </span>
                  </div>
                </div>
              )}
              {hover.peso != null && (
                <div className="pt-1 mt-1 border-t border-slate-100 flex justify-between gap-3">
                  <span>Patrimonio:</span>
                  <span className="tabular-nums text-slate-900">
                    {formatNumberCompact(hover.peso)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLOR_QUAD_IDEAL, border: "1px solid #D1FAE5" }} />
          Cuadrante ideal
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLOR_QUAD_BAD, border: "1px solid #FECACA" }} />
          Zona crítica
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-0.5" style={{ background: COLOR_ARROW_IMPROVE }} />
          Mejoró
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-0.5" style={{ background: COLOR_ARROW_DECLINE }} />
          Deterioró
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-5 h-0.5" style={{ background: COLOR_ARROW_NEUTRAL }} />
          Sin cambio
        </div>
        <div className="ml-auto italic">
          Divisores = mediana del sector · Pasa el mouse sobre un punto para ver detalle
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers externos al componente
// ============================================================================

function label(
  pos: "TL" | "TR" | "BL" | "BR",
  altoBuenoX: boolean,
  altoBuenoY: boolean,
): string {
  // Determina el nombre del cuadrante según si cada posición es "buena" o "mala".
  // Con altoBuenoX=true, altoBuenoY=true (ROE vs Cobertura):
  //   TR = bueno+bueno = Líderes, BL = malo+malo = Zona crítica
  // Con altoBuenoX=true, altoBuenoY=false (ROE vs Mora):
  //   BR = bueno+bueno (ROE alto, Mora baja) = Líderes
  //   TL = malo+malo (ROE bajo, Mora alta) = Zona crítica
  const buenoX = pos[1] === "R" ? altoBuenoX : !altoBuenoX;
  const buenoY = pos[0] === "T" ? altoBuenoY : !altoBuenoY;

  if (buenoX && buenoY) return "⭐ Líderes";
  if (!buenoX && !buenoY) return "💀 Zona crítica";
  if (buenoX && !buenoY) return "⚠️ Agresivos";
  return "🛡️ Conservadores";
}

function delta(prev: number, actual: number, _altoBueno: boolean): string {
  const d = actual - prev;
  const pp = (d * 100).toFixed(1);
  const sign = d > 0 ? "+" : "";
  // Flecha sólo indica dirección del valor (sube/baja). La "bondad" del cambio
  // se interpreta en el color de la flecha global en el gráfico.
  const arrow = Math.abs(d) < 0.001 ? "·" : d > 0 ? "↑" : "↓";
  return `${arrow} ${sign}${pp}pp`;
}
