"use client";

/**
 * SeccionCalidadCartera — bubble chart 2x2 riesgo vs cobertura.
 *
 * X: Cartera de Alto Riesgo Ajustada (menor = mejor calidad crediticia)
 * Y: Provisiones / Cartera atrasada (mayor = mejor colchon)
 *
 * Los datos son OFICIALES SBS del reporte prudencial mensual (los mismos
 * que estan en el archivo B-XXXX / C-XXXX que publica SBS). Aplicable a
 * bancos, financieras, cajas municipales, cajas rurales y edpymes —
 * SBS publica el mismo indicador para todos los grupos.
 *
 * Sin lineas de referencia (mediana del sistema) por decision de producto:
 * el bubble mismo comunica el ranking relativo dentro del peer group.
 *
 * Boton "Generar publicacion IA" reutiliza el pipeline de
 * /api/v1/publicaciones/generate con tema='calidad_cartera'. Gate por
 * PLAN_LIMITS.publicacionesPorMes (Free=0, Trial=3, Pro=20, Business=999).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  type TooltipProps,
} from "recharts";
import { Loader2, Sparkles } from "lucide-react";

import type { CalidadCarteraPoint, Competidor } from "@/lib/domains/informe/types";

type Cuadrante = "GANADOR" | "SOBRECUBIERTO" | "OPTIMISTA" | "FRAGIL";

type CalidadPayload = {
  x: number; // CAR ajustada
  y: number; // cobertura
  label: string;
  color: string;
  esPropia: boolean;
  rank: number; // 1..N por menor CAR
  cuadrante: Cuadrante;
};

const CUADRANTE_META: Record<Cuadrante, { label: string; color: string; halo: string }> = {
  GANADOR:       { label: "GANADOR",       color: "#059669", halo: "#d1fae5" }, // emerald
  SOBRECUBIERTO: { label: "SOBRE-CUBIERTO", color: "#0891b2", halo: "#cffafe" }, // cyan
  OPTIMISTA:     { label: "OPTIMISTA",     color: "#d97706", halo: "#fef3c7" }, // amber
  FRAGIL:        { label: "FRÁGIL",        color: "#dc2626", halo: "#fee2e2" }, // rose
};

export function SeccionCalidadCartera({
  data,
  competidores,
  clienteSlug,
  entidadPropia,
  periodo,
  periodoLabel,
  publicacionesAllowed,
}: {
  data: CalidadCarteraPoint[];
  competidores: Competidor[];
  clienteSlug: string;
  entidadPropia: string;
  periodo: number;
  periodoLabel: string;
  /** Del plan del user: publicacionesPorMes > 0. Free = false. */
  publicacionesAllowed: boolean;
}) {
  const router = useRouter();
  const [generando, setGenerando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (data.length === 0) {
    return (
      <section>
        <SectionHeader />
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
          Sin datos oficiales SBS de Cartera de Alto Riesgo Ajustada para este
          período y peer group. SBS suele publicar este indicador entre 2 y 4
          semanas después del cierre; el sistema lo captura automáticamente en
          la próxima ingesta.
        </div>
      </section>
    );
  }

  // Ranking por menor CAR ajustada (1 = mejor calidad)
  const rankedByCar = [...data].sort((a, b) => a.carAjustada - b.carAjustada);
  const rankMap = new Map<string, number>();
  rankedByCar.forEach((d, i) => rankMap.set(d.nombCorreg, i + 1));

  // Mediana del peer group para separar los 4 cuadrantes visualmente.
  // No es "la mediana del sistema" (que el user pidio no mostrar) — es
  // el centro NATURAL del propio peer group, indispensable para leer
  // los cuadrantes. Sin esta linea de cruce, el user tiene que
  // imaginar donde termina "seguro" y empieza "fragil".
  const sortedX = [...data].map((d) => d.carAjustada).sort((a, b) => a - b);
  const sortedY = [...data].map((d) => d.cobertura).sort((a, b) => a - b);
  const medX = sortedX[Math.floor(sortedX.length / 2)] ?? 0;
  const medY = sortedY[Math.floor(sortedY.length / 2)] ?? 0;

  const clasificarCuadrante = (car: number, cov: number): Cuadrante => {
    if (car <= medX && cov >= medY) return "GANADOR";
    if (car > medX && cov >= medY) return "SOBRECUBIERTO";
    if (car <= medX && cov < medY) return "OPTIMISTA";
    return "FRAGIL";
  };

  // Merge con competidores para colores + flag propia + ranking + cuadrante
  const scatterData: CalidadPayload[] = data.map((d) => {
    const comp = competidores.find((c) => c.nombCorreg === d.nombCorreg);
    return {
      x: d.carAjustada,
      y: d.cobertura,
      label: comp?.labelCorto ?? d.nombCorreg,
      color: comp?.color ?? "#94a3b8",
      esPropia: comp?.esPropio ?? false,
      rank: rankMap.get(d.nombCorreg) ?? 0,
      cuadrante: clasificarCuadrante(d.carAjustada, d.cobertura),
    };
  });

  const xVals = scatterData.map((d) => d.x);
  const yVals = scatterData.map((d) => d.y);
  const xMin = Math.max(0, Math.min(...xVals) - 1.5);
  const xMax = Math.max(...xVals) + 1.5;
  const yMin = Math.max(0, Math.min(...yVals) - 25);
  const yMax = Math.max(...yVals) + 25;

  async function generarPublicacion() {
    if (generando) return;
    setGenerando(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/publicaciones/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tema: "calidad_cartera",
          periodo,
          clienteSlug,
          entidadPropia,
          peerGroup: competidores.map((c) => c.nombCorreg),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json?.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      const id = json?.data?.id ?? json?.id;
      if (id) router.push(`/dashboard/publicaciones/${id}` as never);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error de red");
    } finally {
      setGenerando(false);
    }
  }

  return (
    <section>
      <SectionHeader />
      <p className="text-sm text-slate-500 mb-4 mt-3">
        Peer group al {periodoLabel} sobre matriz 2×2 con cuadrantes
        coloreados. Las líneas grises punteadas marcan la <em>mediana del peer
        group</em> (no del sistema completo). Cada burbuja lleva su
        <strong className="text-slate-700"> ranking de calidad</strong>{" "}
        (1 = menor riesgo). Datos oficiales SBS.
      </p>

      {/* Leyenda de cuadrantes — clave visual para leer el chart */}
      <div className="flex flex-wrap gap-2 mb-3 text-[11px]">
        {(["GANADOR", "SOBRECUBIERTO", "OPTIMISTA", "FRAGIL"] as const).map((k) => {
          const m = CUADRANTE_META[k];
          const desc: Record<Cuadrante, string> = {
            GANADOR: "bajo riesgo + alta cobertura",
            SOBRECUBIERTO: "alto riesgo pero bien cubierto",
            OPTIMISTA: "bajo riesgo pero cobertura delgada",
            FRAGIL: "alto riesgo + baja cobertura",
          };
          return (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border"
              style={{ borderColor: m.color, backgroundColor: m.halo }}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
              <strong style={{ color: m.color }}>{m.label}</strong>
              <span className="text-slate-600">— {desc[k]}</span>
            </span>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <div style={{ width: "100%", height: 440 }}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 40, right: 55, bottom: 55, left: 70 }}>
              {/* ============ ZONAS DE CUADRANTE (fondo sutil) ============
                  Recharts renderiza en orden — poner ANTES del grid + puntos
                  para que quede detras. Con eje X invertido:
                    Visualmente ARRIBA-DERECHA = ganador (bajo car + alta cov)
                    Visualmente ABAJO-IZQUIERDA = fragil (alto car + baja cov)
                  Pero ReferenceArea usa las coords REALES (no visuales) del
                  eje. Con reversed:true en XAxis, x1..x2 se renderiza flip.
              */}
              <ReferenceArea x1={xMin} x2={medX} y1={medY} y2={yMax} fill={CUADRANTE_META.GANADOR.halo} fillOpacity={0.35} />
              <ReferenceArea x1={medX} x2={xMax} y1={medY} y2={yMax} fill={CUADRANTE_META.SOBRECUBIERTO.halo} fillOpacity={0.35} />
              <ReferenceArea x1={xMin} x2={medX} y1={yMin} y2={medY} fill={CUADRANTE_META.OPTIMISTA.halo} fillOpacity={0.35} />
              <ReferenceArea x1={medX} x2={xMax} y1={yMin} y2={medY} fill={CUADRANTE_META.FRAGIL.halo} fillOpacity={0.35} />
              <ReferenceLine x={medX} stroke="#94a3b8" strokeDasharray="4 3" strokeOpacity={0.6} />
              <ReferenceLine y={medY} stroke="#94a3b8" strokeDasharray="4 3" strokeOpacity={0.6} />
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.5} />
              <XAxis
                type="number"
                dataKey="x"
                domain={[xMin, xMax]}
                label={{
                  value: "◄ Menor riesgo    Cartera de Alto Riesgo Ajustada (%)    Mayor riesgo ►",
                  position: "insideBottom",
                  offset: -20,
                  style: { fontSize: 12, fill: "#475569", fontWeight: 500 },
                }}
                tickFormatter={(v) => `${v.toFixed(1)}%`}
                reversed
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={[yMin, yMax]}
                label={{
                  value: "▲ Mejor cobertura    Provisiones / Atrasada (%)    Peor ▼",
                  angle: -90,
                  position: "insideLeft",
                  offset: 0,
                  style: { textAnchor: "middle", fontSize: 12, fill: "#475569", fontWeight: 500 },
                }}
                tickFormatter={(v) => `${v.toFixed(0)}%`}
              />
              <Tooltip
                content={(props: TooltipProps<number, string>) => {
                  const { active, payload } = props;
                  if (!active || !payload || payload.length === 0) return null;
                  const d = payload[0].payload as CalidadPayload | undefined;
                  if (!d) return null;
                  const meta = CUADRANTE_META[d.cuadrante];
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-xs min-w-[240px]">
                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-100">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: d.color }}
                        />
                        <p className="font-semibold text-slate-900">{d.label}</p>
                        {d.esPropia && (
                          <span className="ml-auto text-[10px] uppercase tracking-wider text-brand-700 font-bold">
                            Propia
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-slate-600">
                        <span>Ranking calidad</span>
                        <span className="font-mono font-semibold text-slate-900">
                          #{d.rank} de {scatterData.length}
                        </span>
                        <span>CAR Ajustada</span>
                        <span className="font-mono font-semibold text-slate-900">
                          {d.x.toFixed(2)}%
                        </span>
                        <span>Cobertura</span>
                        <span className="font-mono font-semibold text-slate-900">
                          {d.y.toFixed(2)}%
                        </span>
                        <span className="pt-1 mt-1 border-t border-slate-100">Cuadrante</span>
                        <span
                          className="pt-1 mt-1 border-t border-slate-100 font-semibold"
                          style={{ color: meta.color }}
                        >
                          {meta.label}
                        </span>
                      </div>
                    </div>
                  );
                }}
              />
              <Scatter
                data={scatterData}
                isAnimationActive={false}
                shape={(props: {
                  cx?: number;
                  cy?: number;
                  payload?: CalidadPayload;
                }) => {
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null || !payload) return <g />;
                  const r = payload.esPropia ? 13 : 10;
                  const labelText = payload.label;
                  // Ancho del pill mas generoso: 6.8px por char + padding 16
                  // para evitar truncado tipo "Caja Ar" (bug reportado
                  // 2026-08-25 con Caja Arequipa de 13 chars).
                  const pillW = labelText.length * 6.8 + 16;
                  const pillH = 18;
                  const labelY = cy - r - 12;
                  const cuadColor = CUADRANTE_META[payload.cuadrante].color;
                  return (
                    <g>
                      {payload.esPropia && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={r + 5}
                          fill="none"
                          stroke={payload.color}
                          strokeWidth={2}
                          strokeDasharray="3 2"
                          opacity={0.6}
                        />
                      )}
                      {/* Halo del color del cuadrante — comunica performance a un vistazo */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r + 3}
                        fill={cuadColor}
                        fillOpacity={0.2}
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill={payload.color}
                        fillOpacity={0.9}
                        stroke="#fff"
                        strokeWidth={2}
                        style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.2))" }}
                      />
                      {/* Numero de ranking dentro de la burbuja */}
                      <text
                        x={cx}
                        y={cy + 3}
                        textAnchor="middle"
                        className="text-[10px] font-bold"
                        fill="#fff"
                        style={{ pointerEvents: "none" }}
                      >
                        {payload.rank}
                      </text>
                      <rect
                        x={cx - pillW / 2}
                        y={labelY - pillH + 4}
                        width={pillW}
                        height={pillH}
                        rx={pillH / 2}
                        ry={pillH / 2}
                        fill="#ffffff"
                        fillOpacity={0.95}
                        stroke={payload.color}
                        strokeWidth={1.2}
                        strokeOpacity={0.5}
                      />
                      <text
                        x={cx}
                        y={labelY}
                        textAnchor="middle"
                        className="text-[10px] font-semibold"
                        fill="#0f172a"
                      >
                        {labelText}
                      </text>
                    </g>
                  );
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-slate-400 mt-2 text-center">
          Eje X invertido: valores a la derecha = menor riesgo. Fuente:
          Superintendencia de Banca, Seguros y AFP (SBS) — reporte prudencial{" "}
          {periodoLabel}.
        </p>
      </div>

      {/* Publicación IA — mismo estilo visual que "Analisis del experto" (report-insights.tsx) */}
      <div className="mt-4 rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 print-avoid-break no-print">
        <header className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-700" />
            <h3 className="text-sm font-semibold text-slate-900">Publicación IA</h3>
          </div>
        </header>
          {publicacionesAllowed ? (
            <div className="text-center py-4">
              <p className="text-xs text-slate-500 mb-3">
                Genera un artículo tipo LinkedIn automático basado en los datos de esta sección.
              </p>
              <button
                type="button"
                onClick={generarPublicacion}
                disabled={generando}
                className="inline-flex items-center gap-1.5 h-8 px-3 bg-brand-700 hover:bg-brand-800 text-white text-xs font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generando ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Generando...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Generar publicación con IA
                  </>
                )}
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-4">
              💡 Inicia tu prueba de 14 días para desbloquear publicaciones IA
              que convierten este análisis en un artículo listo para LinkedIn.
            </p>
          )}
          {errorMsg && (
            <p className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5 text-center">
              {errorMsg}
            </p>
          )}
      </div>
    </section>
  );
}

function SectionHeader() {
  return (
    <h2 className="inline-flex items-center gap-2.5 text-sm font-bold uppercase tracking-[0.08em] text-slate-800 mb-1">
      <span className="w-1 h-5 rounded-full bg-brand-500" />
      Calidad de Cartera — Alto Riesgo Ajustado vs Cobertura
    </h2>
  );
}
